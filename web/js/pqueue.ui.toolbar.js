(function () {
    "use strict";

    const state = (window.PQueue && window.PQueue.state) || {};
    const UI = (window.PQueue && window.PQueue.UI) || window.UI;
    const Events = (window.PQueue && window.PQueue.Events) || window.Events;

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

        return UI.el("div", { class: "pqueue-toolbar" }, [
            UI.el("div", { class: "pqueue-toolbar__row" }, [
                UI.el("div", { class: "pqueue-toolbar__group" }, [pauseBtn, clearBtn, executeSelectedBtn]),
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
        } catch (err) { /* noop */ }
    };
})();




