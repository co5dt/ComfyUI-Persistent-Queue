(function () {
    "use strict";

    const UI = (window.PQueue && window.PQueue.UI) || window.UI;
    const state = (window.PQueue && window.PQueue.state) || {};

    UI.mountFallback = function mountFallback() {
        if (document.getElementById("pqueue-fallback-panel")) {
            state.container = document.querySelector("#pqueue-fallback-panel .pqueue-fallback__content");
            return;
        }
        const fab = UI.el("button", { id: "pqueue-fab", class: "pqueue-fab", type: "button" }, [UI.icon("ti ti-history", { size: "md" }), UI.el("span", { class: "pqueue-fab__label", text: "Persistent Queue" })]);
        const panel = UI.el("div", { id: "pqueue-fallback-panel", class: "pqueue-fallback", "data-open": "false" });
        const header = UI.el("header", { class: "pqueue-fallback__header" }, [UI.el("div", { class: "pqueue-fallback__title", text: "Persistent Queue" }), UI.button({ icon: "ti ti-x", variant: "ghost", subtle: true, title: "Close", onClick: () => panel.setAttribute("data-open", "false") })]);
        const content = UI.el("div", { class: "pqueue-fallback__content" });
        panel.appendChild(header);
        panel.appendChild(content);
        document.body.appendChild(panel);
        document.body.appendChild(fab);
        fab.addEventListener("click", () => {
            const open = panel.getAttribute("data-open") === "true";
            panel.setAttribute("data-open", open ? "false" : "true");
            if (!open) refresh({ skipIfBusy: true });
        });
        state.container = content;
    };

    UI.removeFallback = function removeFallback() {
        document.getElementById("pqueue-fab")?.remove();
        document.getElementById("pqueue-fallback-panel")?.remove();
    };
})();




