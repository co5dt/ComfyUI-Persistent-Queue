(function () {
    "use strict";

    const PQ = window.PQueue = window.PQueue || {};

    const API = {
        getQueue: () => fetch("/api/pqueue").then((r) => r.json()),
        getHistory: (limit = 50) => fetch(`/api/pqueue/history?limit=${limit}`).then((r) => r.json()),
        getHistoryPaginated: (params = {}) => {
            const url = new URL("/api/pqueue/history", window.location.origin);
            Object.entries(params).forEach(([k, v]) => {
                if (v === undefined || v === null || v === "") return;
                url.searchParams.set(k, String(v));
            });
            return fetch(url.href).then((r) => r.json());
        },
        pause: () => fetch("/api/pqueue/pause", { method: "POST" }),
        resume: () => fetch("/api/pqueue/resume", { method: "POST" }),
        reorder: (order) =>
            fetch("/api/pqueue/reorder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ order }),
            }),
        exportQueue: () =>
            fetch("/api/pqueue/export", { method: "GET" }).then((r) => r.json()),
        importQueue: (fileOrJson) => {
            try {
                if (fileOrJson instanceof File || fileOrJson instanceof Blob) {
                    const form = new FormData();
                    form.append("file", fileOrJson, fileOrJson.name || "queue.json");
                    return fetch("/api/pqueue/import", { method: "POST", body: form }).then((r) => r.json());
                }
            } catch (err) { /* fall through to JSON */ }
            return fetch("/api/pqueue/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(fileOrJson),
            }).then((r) => r.json());
        },
        setPriority: (prompt_id, priority) =>
            fetch("/api/pqueue/priority", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt_id, priority }),
            }),
        del: (prompt_ids) =>
            fetch("/api/pqueue/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt_ids }),
            }),
        rename: (prompt_id, name) =>
            fetch("/api/pqueue/rename", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt_id, name }),
            }),
        runSelectedJobs: (prompt_ids) =>
            fetch("/api/pqueue/run-selected", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt_ids }),
            }),
        skipSelectedJobs: (prompt_ids) =>
            fetch("/api/pqueue/skip-selected", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt_ids }),
            }),
    };

    PQ.API = API;
    window.API = API;
})();


