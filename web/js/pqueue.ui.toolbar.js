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

        return UI.el("div", { class: "pqueue-toolbar" }, [
            UI.el("div", { class: "pqueue-toolbar__row" }, [
                UI.el("div", { class: "pqueue-toolbar__group" }, [pauseBtn, clearBtn]),
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
        } catch (err) { /* noop */ }
    };
})();




