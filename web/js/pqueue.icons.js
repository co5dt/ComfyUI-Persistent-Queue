(function () {
    "use strict";

    const PQ = window.PQueue = window.PQueue || {};

    const Icons = {
        _ns: "http://www.w3.org/2000/svg",
        _svg(attrs = {}) {
            const svg = document.createElementNS(Icons._ns, "svg");
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("width", "1em");
            svg.setAttribute("height", "1em");
            svg.setAttribute("aria-hidden", "true");
            Object.entries(attrs).forEach(([k, v]) => svg.setAttribute(k, v));
            return svg;
        },
        _path(d, attrs = {}) {
            const p = document.createElementNS(Icons._ns, "path");
            p.setAttribute("d", d);
            Object.entries(attrs).forEach(([k, v]) => p.setAttribute(k, v));
            return p;
        },
        _strokeSvg(paths) {
            const svg = Icons._svg({ fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round" });
            paths.forEach((d) => svg.appendChild(Icons._path(d)));
            return svg;
        },
        _filledSvg(paths) {
            const svg = Icons._svg({ fill: "currentColor" });
            paths.forEach((d) => svg.appendChild(Icons._path(d)));
            return svg;
        },
        resolve(name) {
            const base = String(name || "").trim();
            const key = base.split(/\s+/).pop().replace(/^ti-/, "");
            switch (key) {
                case "player-play":
                    return Icons._strokeSvg(["M8 5v14l11-7z"]);
                case "player-play-filled":
                    return Icons._filledSvg(["M8 5v14l11-7z"]);
                case "player-pause":
                case "player-pause-filled":
                    return Icons._filledSvg(["M6 5h4v14H6z", "M14 5h4v14h-4z"]);
                case "player-stop":
                    return Icons._filledSvg(["M6 6h12v12H6z"]);
                case "refresh":
                    return Icons._strokeSvg(["M20 11a8 8 0 1 0-2.36 5.65M20 11v-5M20 11h-5"]);
                case "trash":
                    return Icons._strokeSvg(["M4 7h16", "M7 7v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7", "M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"]);
                case "drag-drop":
                    return Icons._strokeSvg(["M7 6h.01","M12 6h.01","M17 6h.01","M7 12h.01","M12 12h.01","M17 12h.01","M7 18h.01","M12 18h.01","M17 18h.01"]);
                case "arrow-bar-to-up":
                    return Icons._strokeSvg(["M12 4v10","M8 8l4-4 4 4","M4 20h16"]);
                case "arrow-bar-to-down":
                    return Icons._strokeSvg(["M12 20V10","M8 16l4 4 4-4","M4 4h16"]);
                case "loader-2":
                    return Icons._strokeSvg(["M12 3a9 9 0 1 0 9 9"]);
                case "circle-check":
                    return Icons._strokeSvg(["M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0","M9 12l2 2 4-4"]);
                case "alert-triangle":
                    return Icons._strokeSvg(["M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z","M12 9v4","M12 17h.01"]);
                case "clock-hour-3":
                    return Icons._strokeSvg(["M12 7v5l4 2","M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"]);
                case "circle-dashed":
                    return Icons._strokeSvg(["M12 3a9 9 0 0 1 9 9","M21 12a9 9 0 0 1-9 9","M12 21a9 9 0 0 1-9-9","M3 12a9 9 0 0 1 9-9"]);
                case "x":
                    return Icons._strokeSvg(["M6 6l12 12","M6 18L18 6"]);
                case "chevron-left":
                    return Icons._strokeSvg(["M15 6l-6 6 6 6"]);
                case "chevron-right":
                    return Icons._strokeSvg(["M9 6l6 6-6 6"]);
                case "copy":
                    return Icons._strokeSvg(["M8 8h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z","M4 16V6a2 2 0 0 1 2-2h8"]);
                case "history":
                    return Icons._strokeSvg(["M3 13a9 9 0 1 0 3-7","M3 13H7","M12 7v6l4 2"]);
                case "activity-heartbeat":
                    return Icons._strokeSvg(["M3 12h4l2-3 3 6 2-3h5"]);
                case "stack-front":
                case "stack-2":
                    return Icons._strokeSvg(["M12 4l8 4-8 4-8-4 8-4z","M4 12l8 4 8-4","M4 16l8 4 8-4"]);
                case "bolt":
                    return Icons._strokeSvg(["M13 3L4 14h7l-1 7 9-11h-7z"]);
                case "info-circle":
                    return Icons._strokeSvg(["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z","M12 8h.01","M11 12h2v6h-2z"]);
                default:
                    return null;
            }
        }
    };

    PQ.Icons = Icons;
    window.Icons = Icons;
})();


