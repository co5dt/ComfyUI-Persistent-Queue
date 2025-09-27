(function () {
    "use strict";

    const UI = (window.PQueue && window.PQueue.UI) || (window.PQueue = (window.PQueue || {}), window.PQueue.UI = {}, window.PQueue.UI);

    UI.ensureGallery = function ensureGallery() {
        if (UI.galleryOverlay) return;
        const overlay = UI.el("div", { class: "pqueue-gallery-overlay" });
        const box = UI.el("div", { class: "pqueue-gallery" });
        const closeBtn = UI.button({ icon: "ti ti-x", variant: "ghost", subtle: true, title: "Close" });
        closeBtn.addEventListener("click", UI.closeGallery);
        const img = UI.el("img", { class: "pqueue-gallery__img" });
        const counter = UI.el("div", { class: "pqueue-gallery__counter" });
        const prev = UI.button({ icon: "ti ti-chevron-left", variant: "ghost", subtle: true, title: "Previous" });
        prev.addEventListener("click", () => UI.galleryShow(UI.galleryState.index - 1));
        const next = UI.button({ icon: "ti ti-chevron-right", variant: "ghost", subtle: true, title: "Next" });
        next.addEventListener("click", () => UI.galleryShow(UI.galleryState.index + 1));

        box.appendChild(closeBtn);
        box.appendChild(img);
        box.appendChild(counter);
        box.appendChild(prev);
        box.appendChild(next);
        overlay.appendChild(box);

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) UI.closeGallery();
        });

        document.body.appendChild(overlay);
        UI.galleryOverlay = overlay;
        UI.galleryImg = img;
        UI.galleryCounter = counter;
        UI.galleryState = { images: [], index: 0, pid: null };
    };

    UI.openGallery = function openGallery(images, startIndex = 0, pid = null) {
        UI.ensureGallery();
        UI.galleryState.images = images || [];
        UI.galleryState.pid = pid;
        UI.galleryState.index = Math.max(0, Math.min(startIndex, UI.galleryState.images.length - 1));
        UI.galleryOverlay.style.display = "flex";
        UI.galleryShow(UI.galleryState.index);
        UI.bindGalleryKeys(true);
    };

    UI.closeGallery = function closeGallery() {
        if (UI.galleryOverlay) UI.galleryOverlay.style.display = "none";
        UI.bindGalleryKeys(false);
    };

    UI.galleryShow = function galleryShow(index) {
        const images = UI.galleryState.images;
        if (!images.length) return;
        UI.galleryState.index = (index + images.length) % images.length;
        const desc = images[UI.galleryState.index];
        UI.galleryImg.src = UI.buildPreviewUrl(desc, UI.galleryState.pid).href;
        UI.galleryCounter.textContent = `${UI.galleryState.index + 1} / ${images.length}`;
    };

    UI.bindGalleryKeys = function bindGalleryKeys(enabled) {
        const handler = (e) => {
            if (!UI.galleryOverlay || UI.galleryOverlay.style.display !== "flex") return;
            if (e.key === "Escape") UI.closeGallery();
            else if (e.key === "ArrowRight") UI.galleryShow(UI.galleryState.index + 1);
            else if (e.key === "ArrowLeft") UI.galleryShow(UI.galleryState.index - 1);
        };
        if (enabled) {
            UI.galleryKeyHandler = handler;
            document.addEventListener("keydown", handler);
        } else if (UI.galleryKeyHandler) {
            document.removeEventListener("keydown", UI.galleryKeyHandler);
            UI.galleryKeyHandler = null;
        }
    };
})();




