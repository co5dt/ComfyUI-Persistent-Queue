(function () {
    "use strict";

    const PQ = window.PQueue = window.PQueue || {};

    function setStatusMessage(message, duration = 2500) {
        const state = PQ.state;
        if (!state) return;
        if (state.statusTimer) {
            clearTimeout(state.statusTimer);
            state.statusTimer = null;
        }
        state.statusMessage = message || null;
        if (PQ.UI && typeof PQ.UI.updateToolbarStatus === 'function') {
            try { PQ.UI.updateToolbarStatus(); } catch (err) {}
        }
        if (message && duration > 0) {
            state.statusTimer = window.setTimeout(() => {
                state.statusMessage = null;
                state.statusTimer = null;
                if (PQ.UI && typeof PQ.UI.updateToolbarStatus === 'function') {
                    try { PQ.UI.updateToolbarStatus(); } catch (err) {}
                }
            }, duration);
        }
    }

    function copyText(text) {
        const onOk = () => setStatusMessage("Workflow copied to clipboard");
        const onFail = () => setStatusMessage("Copy failed", 4000);
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text).then(onOk, () => fallbackCopy(text));
        } else {
            fallbackCopy(text);
        }

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
                onOk();
            } catch (err) {
                onFail();
            }
        }
    }

    PQ.setStatusMessage = setStatusMessage;
    PQ.copyText = copyText;
    window.setStatusMessage = setStatusMessage;
    window.copyText = copyText;
})();


