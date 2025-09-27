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


		// Build summary (used as metrics card header content)
		const buildSummary = () => {
			const wrap = UI.el("div", { class: "pqueue-toolbar__summary" });
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
			const srVal = (m.successRate != null) ? `${Math.round((m.successRate || 0) * 100)}%` : "—";
			const successEl = item("ti ti-chart-pie", "SR", srVal);
			const etaVal = m.estimatedTotalDuration ? Format.duration(m.estimatedTotalDuration) : "—";
			const etaEl = item("ti ti-hourglass-high", "ETA", etaVal);
			etaEl.title = [
				m.estimatedRunningDuration ? `Running ~${Format.duration(m.estimatedRunningDuration)}` : null,
				m.estimatedPendingDuration ? `Pending ~${Format.duration(m.estimatedPendingDuration)}` : null,
			].filter(Boolean).join(" • ") || "Estimated total duration based on recent averages";

			state.dom.summary = wrap;
			state.dom.summaryRunning = runningEl.querySelector('.pqueue-code');
			state.dom.summaryPending = pendingEl.querySelector('.pqueue-code');
			state.dom.summaryHistory = historyEl.querySelector('.pqueue-code');
			state.dom.summarySuccess = successEl.querySelector('.pqueue-code');
			state.dom.summaryEta = etaEl.querySelector('.pqueue-code');

			wrap.appendChild(runningEl);
			wrap.appendChild(pendingEl);
			wrap.appendChild(etaEl);
			wrap.appendChild(successEl);
			wrap.appendChild(historyEl);
			return wrap;
		};

		// Build metrics body (tiles)
		UI.buildToolbarMetricsTiles = function buildToolbarMetricsTiles() {
			const m = state.metrics || {};
			const tiles = [
				UI.metricTile({
					icon: "ti ti-chart-pie",
					label: "Success rate",
					value: m.successRate != null ? `${Math.round((m.successRate || 0) * 100)}%` : "—",
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
					variant: "neutral",
					tooltip: "Sum of per-workflow averages for running (remaining) and pending items. Per-workflow averages are computed from recent history; if unavailable, falls back to global average duration.",
				}),
			];
			return UI.el("div", { class: "pqueue-metrics" }, tiles);
		};

		// Metrics card inside toolbar
		const toggleBtn = UI.button({
			id: "pqueue-metrics-toggle",
			icon: state.uiMetricsCollapsed ? "ti ti-chevron-down" : "ti ti-chevron-up",
			variant: "ghost",
			subtle: true,
			title: state.uiMetricsCollapsed ? "Expand metrics" : "Collapse metrics",
			ariaLabel: state.uiMetricsCollapsed ? "Expand metrics" : "Collapse metrics",
		});
		toggleBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			try { UI.toggleToolbarMetricsCard(); } catch (err) { /* noop */ }
		});
		const actions = UI.el("div", { class: "pqueue-card__actions" }, [toggleBtn]);
		const metricsHeader = UI.el("header", { class: "pqueue-card__header" });
		const metricsTitle = UI.el("h3", { class: "pqueue-card__title", text: "Metrics" });
		try { metricsTitle.style.transition = 'opacity 120ms ease'; metricsTitle.style.opacity = state.uiMetricsCollapsed ? '0' : '1'; } catch (err) { /* noop */ }
		metricsHeader.appendChild(metricsTitle);
		const summaryEl = buildSummary();
		try { summaryEl.style.transition = 'opacity 120ms ease'; summaryEl.style.opacity = state.uiMetricsCollapsed ? '1' : '0'; if (!state.uiMetricsCollapsed) summaryEl.style.display = 'none'; } catch (err) { /* noop */ }
		metricsHeader.appendChild(summaryEl);
		metricsHeader.appendChild(actions);
		try { metricsHeader.style.cursor = 'pointer'; } catch (err) { /* noop */ }
		try { metricsHeader.title = 'Show queue metrics'; } catch (err) { /* noop */ }
		metricsHeader.addEventListener('click', () => {
			try { UI.toggleToolbarMetricsCard(); } catch (err) { /* noop */ }
		});
		const metricsBody = UI.el("div", { class: "pqueue-card__body" }, [UI.buildToolbarMetricsTiles()]);
		try {
			metricsBody.style.overflow = 'hidden';
			metricsBody.style.transition = 'height 120ms ease, opacity 120ms ease';
		} catch (err) { /* noop */ }
		const metricsCard = UI.el("section", { class: ["pqueue-card", "pqueue-card--metrics"] }, [metricsHeader]);
		metricsCard.appendChild(metricsBody);
		state.dom.toolbarMetricsCard = metricsCard;
		state.dom.toolbarMetricsBody = metricsBody;
		state.dom.toolbarMetricsToggle = toggleBtn;
		state.dom.toolbarMetricsTitle = metricsTitle;
		state.dom.toolbarMetricsSummary = summaryEl;
		try { metricsCard.setAttribute('data-collapsed', state.uiMetricsCollapsed ? 'true' : 'false'); } catch (err) { /* noop */ }
		if (state.uiMetricsCollapsed) {
			try { metricsBody.style.height = '0px'; metricsBody.style.opacity = '0'; } catch (err) { /* noop */ }
			// Hide title when collapsed; show summary
			try { metricsTitle.style.display = 'none'; } catch (err) { /* noop */ }
		} else {
			// Hide the summary when expanded; show title
			try {
				const s = metricsHeader.querySelector('.pqueue-toolbar__summary');
				if (s) { s.style.display = 'none'; s.style.opacity = '0'; }
			} catch (err) { /* noop */ }
			try { metricsTitle.style.display = ''; } catch (err) { /* noop */ }
		}

		return UI.el("div", { class: "pqueue-toolbar" }, [
			UI.el("div", { class: "pqueue-toolbar__row" }, [
				UI.el("div", { class: "pqueue-toolbar__group" }, [pauseBtn, clearBtn, executeSelectedBtn]),
			]),
			metricsCard,
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

			// Show/Hide summary based on collapsed state
			try {
				const header = state.dom.toolbarMetricsCard && state.dom.toolbarMetricsCard.querySelector('.pqueue-card__header');
				const summary = header && header.querySelector('.pqueue-toolbar__summary');
				if (summary) summary.style.display = state.uiMetricsCollapsed ? '' : 'none';
			} catch (err) { /* noop */ }

			// Rebuild metrics tiles if card exists
			if (state.dom.toolbarMetricsBody && state.dom.toolbarMetricsBody.parentNode) {
				const body = state.dom.toolbarMetricsBody;
				const isCollapsed = !!state.uiMetricsCollapsed;
				const prevHeight = body.scrollHeight;
				body.innerHTML = '';
				const grid = UI.buildToolbarMetricsTiles();
				body.appendChild(grid);
				// keep collapsed state without jump
				if (isCollapsed) {
					try { body.style.height = '0px'; body.style.opacity = '0'; } catch (err) { /* noop */ }
				} else {
					try {
						const target = grid.scrollHeight || prevHeight;
						body.style.height = `${target}px`;
						body.style.opacity = '1';
					} catch (err) { /* noop */ }
				}
			}
        } catch (err) { /* noop */ }
	};

	UI.toggleToolbarMetricsCard = function toggleToolbarMetricsCard() {
		try {
			const card = state.dom.toolbarMetricsCard;
			const body = state.dom.toolbarMetricsBody;
			const toggle = state.dom.toolbarMetricsToggle;
			if (!card || !body) return;
			const isCollapsed = !!state.uiMetricsCollapsed;
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
					try { card.setAttribute('data-collapsed', 'true'); } catch (err) { /* noop */ }
					state.uiMetricsCollapsed = true;
				try { const s = card.querySelector('.pqueue-toolbar__summary'); if (s) s.style.display = ''; } catch (err) { /* noop */ }
				try {
					if (state.dom.toolbarMetricsTitle) {
						state.dom.toolbarMetricsTitle.style.opacity = '0';
						const t = state.dom.toolbarMetricsTitle;
						window.requestAnimationFrame(() => { try { t.style.display = 'none'; } catch (err) { } });
					}
					if (state.dom.toolbarMetricsSummary) {
						const s = state.dom.toolbarMetricsSummary;
						s.style.display = '';
						s.style.opacity = '0';
						window.requestAnimationFrame(() => { try { s.style.opacity = '1'; } catch (err) { } });
					}
				} catch (err) { /* noop */ }
					try {
						if (toggle) {
							toggle.title = 'Expand metrics';
							toggle.setAttribute('aria-label', 'Expand metrics');
							toggle.innerHTML = '';
							toggle.appendChild(UI.icon('ti ti-chevron-down'));
						}
					} catch (err) { /* noop */ }
				};
				body.addEventListener('transitionend', onEnd);
			} else {
				const grid = body.firstElementChild;
				const target = grid ? grid.scrollHeight : body.scrollHeight;
				body.style.height = '0px';
				body.style.opacity = '0';
				requestAnimationFrame(() => {
					const h = (grid && grid.scrollHeight) || target || 0;
					body.style.height = `${h}px`;
					body.style.opacity = '1';
				});
				const onEnd = () => {
					body.removeEventListener('transitionend', onEnd);
					try { body.style.height = ''; card.setAttribute('data-collapsed', 'false'); } catch (err) { /* noop */ }
					state.uiMetricsCollapsed = false;
				try { const s = card.querySelector('.pqueue-toolbar__summary'); if (s) s.style.display = 'none'; } catch (err) { /* noop */ }
				try {
					if (state.dom.toolbarMetricsTitle) {
						const t = state.dom.toolbarMetricsTitle;
						t.style.display = '';
						t.style.opacity = '0';
						window.requestAnimationFrame(() => { try { t.style.opacity = '1'; } catch (err) { } });
					}
					if (state.dom.toolbarMetricsSummary) {
						const s = state.dom.toolbarMetricsSummary;
						s.style.opacity = '0';
						window.requestAnimationFrame(() => { try { s.style.display = 'none'; } catch (err) { } });
					}
				} catch (err) { /* noop */ }
					try {
						if (toggle) {
							toggle.title = 'Collapse metrics';
							toggle.setAttribute('aria-label', 'Collapse metrics');
							toggle.innerHTML = '';
							toggle.appendChild(UI.icon('ti ti-chevron-up'));
						}
					} catch (err) { /* noop */ }
				};
				body.addEventListener('transitionend', onEnd);
			}
		} catch (err) { /* noop */ }
	};
})();




