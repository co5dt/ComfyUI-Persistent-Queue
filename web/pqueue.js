// Module loader for ComfyUI Persistent Queue (split build)
(function () {
    "use strict";

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = src;
            s.async = false;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    async function boot() {
        const base = "/extensions/ComfyUI-PersistentQueue/js";
        const files = [
            `${base}/pqueue.state.js`,
            `${base}/pqueue.api.js`,
            `${base}/pqueue.icons.js`,
            `${base}/pqueue.format.js`,
            `${base}/pqueue.util.js`,
            `${base}/pqueue.events.js`,
            `${base}/pqueue.ui.js`,
            `${base}/pqueue.runtime.js`,
        ];
        for (const f of files) await loadScript(f);
        if (typeof window.initializePQueue === "function") window.initializePQueue();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => boot());
    else boot();
})();


