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

        // Accessibility and focus management
        try {
            overlay.setAttribute("role", "dialog");
            overlay.setAttribute("aria-modal", "true");
            overlay.tabIndex = -1;
        } catch (err) { /* noop */ }

        // Zoom/Pan state and helpers
        UI.galleryZoom = { scale: 1, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0 };
        UI.updateGalleryTransform = function updateGalleryTransform() {
            try {
                const z = UI.galleryZoom || { scale: 1, x: 0, y: 0, dragging: false };
                img.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.scale})`;
                img.style.cursor = z.scale > 1 ? (z.dragging ? "grabbing" : "grab") : "default";
                img.style.userSelect = "none";
                img.style.willChange = "transform";
                img.draggable = false;
            } catch (err) { /* noop */ }
        };
        UI.resetGalleryTransform = function resetGalleryTransform() {
            UI.galleryZoom = { scale: 1, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0 };
            UI.updateGalleryTransform();
        };

        // Double-click to toggle zoom (2x default)
        img.addEventListener("dblclick", (e) => {
            try {
                e.preventDefault();
                const z = UI.galleryZoom || (UI.galleryZoom = { scale: 1, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0 });
                if (z.scale === 1) {
                    z.scale = 2;
                } else {
                    z.scale = 1; z.x = 0; z.y = 0;
                }
                UI.updateGalleryTransform();
            } catch (err) { /* noop */ }
        });

        // Wheel for fine zoom (1x - 5x)
        const onWheel = (e) => {
            try {
                e.preventDefault();
                const z = UI.galleryZoom || (UI.galleryZoom = { scale: 1, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0 });
                const step = e.deltaY > 0 ? -0.2 : 0.2;
                const next = Math.max(1, Math.min(5, Number(z.scale || 1) + step));
                z.scale = Number(next.toFixed(2));
                if (z.scale === 1) { z.x = 0; z.y = 0; }
                UI.updateGalleryTransform();
            } catch (err) { /* noop */ }
        };
        img.addEventListener("wheel", onWheel, { passive: false });

        // Drag to pan when zoomed
        img.addEventListener("mousedown", (e) => {
            try {
                if (!UI.galleryZoom || UI.galleryZoom.scale <= 1) return;
                e.preventDefault();
                UI.galleryZoom.dragging = true;
                UI.galleryZoom.lastX = e.clientX;
                UI.galleryZoom.lastY = e.clientY;
                UI.updateGalleryTransform();
            } catch (err) { /* noop */ }
        });
        const onMove = (e) => {
            try {
                const z = UI.galleryZoom;
                if (!z || !z.dragging) return;
                const dx = e.clientX - z.lastX;
                const dy = e.clientY - z.lastY;
                z.x += dx; z.y += dy; z.lastX = e.clientX; z.lastY = e.clientY;
                UI.updateGalleryTransform();
            } catch (err) { /* noop */ }
        };
        const onUp = () => {
            try {
                if (!UI.galleryZoom) return;
                UI.galleryZoom.dragging = false;
                UI.updateGalleryTransform();
            } catch (err) { /* noop */ }
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);

        // Focus trap within gallery controls
        UI.bindGalleryFocusTrap = function bindGalleryFocusTrap(enabled) {
            const trapHandler = (e) => {
                try {
                    if (!UI.galleryOverlay || UI.galleryOverlay.style.display !== "flex") return;
                    if (e.key !== "Tab") return;
                    const focusables = [closeBtn, prev, next].filter(Boolean);
                    if (!focusables.length) return;
                    const current = document.activeElement;
                    const idx = Math.max(0, focusables.indexOf(current));
                    e.preventDefault();
                    const dir = e.shiftKey ? -1 : 1;
                    const nextIdx = (idx + dir + focusables.length) % focusables.length;
                    focusables[nextIdx].focus();
                } catch (err) { /* noop */ }
            };
            if (enabled) {
                UI.galleryFocusTrapHandler = trapHandler;
                overlay.addEventListener("keydown", trapHandler);
            } else if (UI.galleryFocusTrapHandler) {
                overlay.removeEventListener("keydown", UI.galleryFocusTrapHandler);
                UI.galleryFocusTrapHandler = null;
            }
        };

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
        UI.bindGalleryFocusTrap(true);
        try {
            UI._galleryPrevFocus = document.activeElement || null;
            // Focus the close button initially
            const btn = UI.galleryOverlay.querySelector(".pqueue-button");
            if (btn && typeof btn.focus === "function") btn.focus();
            else UI.galleryOverlay.focus();
        } catch (err) { /* noop */ }
    };

    UI.closeGallery = function closeGallery() {
        if (UI.galleryOverlay) UI.galleryOverlay.style.display = "none";
        UI.bindGalleryKeys(false);
        UI.bindGalleryFocusTrap(false);
        try { UI.resetGalleryTransform && UI.resetGalleryTransform(); } catch (err) { /* noop */ }
        try {
            if (UI._galleryPrevFocus && document.body.contains(UI._galleryPrevFocus)) {
                UI._galleryPrevFocus.focus();
            }
        } catch (err) { /* noop */ }
    };

    UI.galleryShow = function galleryShow(index) {
        const images = UI.galleryState.images;
        if (!images.length) return;
        UI.galleryState.index = (index + images.length) % images.length;
        const desc = images[UI.galleryState.index];
        UI.galleryImg.src = UI.buildPreviewUrl(desc, UI.galleryState.pid).href;
        UI.galleryCounter.textContent = `${UI.galleryState.index + 1} / ${images.length}`;
        try { UI.resetGalleryTransform && UI.resetGalleryTransform(); } catch (err) { /* noop */ }
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




