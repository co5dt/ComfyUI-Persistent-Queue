(function () {
    "use strict";

    const UI = (window.PQueue && window.PQueue.UI) || window.UI;
    const copyText = (window.PQueue && window.PQueue.copyText) || window.copyText;

    UI.ensureWorkflowModal = function ensureWorkflowModal() {
        if (UI.workflowOverlay) return;
        const overlay = UI.el("div", { class: "pqueue-modal" });
        const dialog = UI.el("div", { class: "pqueue-modal__dialog" });
        const header = UI.el("header", { class: "pqueue-modal__header" });
        const title = UI.el("h3", { class: "pqueue-modal__title" });
        const subtitle = UI.el("div", { class: "pqueue-modal__subtitle" });
        const copyBtn = UI.button({ icon: "ti ti-copy", text: "Copy JSON", variant: "ghost", subtle: true });
        copyBtn.dataset.action = "workflow-copy";
        const closeBtn = UI.button({ icon: "ti ti-x", variant: "ghost", subtle: true, title: "Close" });
        closeBtn.addEventListener("click", UI.closeWorkflowModal);
        header.appendChild(title);
        header.appendChild(subtitle);
        header.appendChild(UI.el("div", { class: "pqueue-modal__actions" }, [copyBtn, closeBtn]));
        const body = UI.el("div", { class: "pqueue-modal__body" });
        const code = UI.el("pre", { class: "pqueue-modal__code" });
        body.appendChild(code);
        dialog.appendChild(header);
        dialog.appendChild(body);
        overlay.appendChild(dialog);
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) UI.closeWorkflowModal();
        });
        document.body.appendChild(overlay);
        UI.workflowOverlay = overlay;
        UI.workflowDialog = dialog;
        UI.workflowTitle = title;
        UI.workflowSubtitle = subtitle;
        UI.workflowCode = code;
        UI.workflowCopyBtn = copyBtn;
        UI.workflowCopyBtn.addEventListener("click", () => {
            if (UI.workflowCode?.textContent) copyText(UI.workflowCode.textContent);
        });
        UI.workflowKeyHandler = (e) => {
            if (e.key === "Escape") UI.closeWorkflowModal();
        };
        document.addEventListener("keydown", UI.workflowKeyHandler);
    };

    UI.openWorkflowModal = function openWorkflowModal({ promptId, workflowText, sourceLabel }) {
        UI.ensureWorkflowModal();
        UI.workflowOverlay.style.display = "flex";
        UI.workflowTitle.textContent = `Workflow for ${promptId}`;
        UI.workflowSubtitle.textContent = sourceLabel ? `Source: ${sourceLabel}` : "";
        UI.workflowCode.textContent = workflowText;
    };

    UI.closeWorkflowModal = function closeWorkflowModal() {
        if (UI.workflowOverlay) UI.workflowOverlay.style.display = "none";
    };
})();




