(function () {
    "use strict";

    const PQ = window.PQueue = window.PQueue || {};

    const Progress = {
        computeAggregate(nodes) {
            let totalMax = 0;
            let totalVal = 0;
            Object.values(nodes ?? {}).forEach((st) => {
                if (st.state !== 'running') return;
                const max = Math.max(1, Number(st?.max ?? 1));
                const val = Math.max(0, Math.min(Number(st?.value ?? 0), max));
                totalMax += max;
                totalVal += val;
            });
            if (!totalMax) return 0;
            return Math.max(0, Math.min(1, totalVal / totalMax));
        },
    };

    const Format = {
        relative(iso) {
            if (!iso) return "";
            const date = new Date(iso);
            if (!isFinite(date.getTime())) return "";
            const diff = date.getTime() - Date.now();
            const abs = Math.abs(diff);
            const units = [
                { limit: 45 * 1000, div: 1000, unit: "second" },
                { limit: 45 * 60 * 1000, div: 60 * 1000, unit: "minute" },
                { limit: 22 * 60 * 60 * 1000, div: 60 * 60 * 1000, unit: "hour" },
                { limit: 26 * 24 * 60 * 60 * 1000, div: 24 * 60 * 60 * 1000, unit: "day" },
                { limit: 11 * 30 * 24 * 60 * 60 * 1000, div: 30 * 24 * 60 * 60 * 1000, unit: "month" },
            ];
            let value = diff;
            let unit = "year";
            for (const u of units) {
                if (abs < u.limit) {
                    value = diff / u.div;
                    unit = u.unit;
                    break;
                }
            }
            if (unit === "year") value = diff / (365 * 24 * 60 * 60 * 1000);
            value = Math.round(value);
            if (typeof Intl !== "undefined" && Intl.RelativeTimeFormat) {
                const rtf = Format._rtf || (Format._rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }));
                return rtf.format(value, unit);
            }
            const suffix = value === 0 ? "now" : value < 0 ? "ago" : "from now";
            return `${Math.abs(value)} ${unit}${Math.abs(value) === 1 ? "" : "s"} ${suffix}`;
        },

        datetime(iso) {
            if (!iso) return "";
            const d = new Date(iso);
            if (!isFinite(d.getTime())) return "";
            return d.toLocaleString();
        },

        duration(seconds) {
            if (!isFinite(seconds) || seconds <= 0) return "";
            const sec = Math.round(seconds);
            if (sec < 60) return `${sec}s`;
            const minutes = Math.floor(sec / 60);
            const remSec = sec % 60;
            if (minutes < 60) return remSec ? `${minutes}m ${remSec}s` : `${minutes}m`;
            const hours = Math.floor(minutes / 60);
            const remMin = minutes % 60;
            if (hours < 24) return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
            const days = Math.floor(hours / 24);
            const remHours = hours % 24;
            return remHours ? `${days}d ${remHours}h` : `${days}d`;
        },

        percent(frac) {
            const n = Number(frac);
            if (!isFinite(n) || n < 0) return "0%";
            return `${Math.min(100, Math.max(0, n * 100)).toFixed(0)}%`;
        },

        statusLabel(status) {
            const s = String(status || "").toLowerCase();
            if (["success", "completed", "done"].includes(s)) return "Success";
            if (["running", "executing", "in-progress"].includes(s)) return "Running";
            if (["failed", "error", "failure"].includes(s)) return "Failed";
            if (["cancelled", "canceled", "interrupted", "stopped"].includes(s)) return "Interrupted";
            if (["pending", "queued", "waiting"].includes(s)) return "Pending";
            return status || "Unknown";
        },

        tooltip(row) {
            if (!row) return "";
            const lines = [];
            if (row.prompt_id) lines.push(`Prompt ID: ${row.prompt_id}`);
            if (row.created_at) lines.push(`Created: ${Format.datetime(row.created_at)}`);
            if (row.completed_at) lines.push(`Completed: ${Format.datetime(row.completed_at)}`);
            if (row.status) lines.push(`Status: ${Format.statusLabel(row.status)}`);
            if (row.duration_seconds) lines.push(`Duration: ${Format.duration(Number(row.duration_seconds))}`);
            if (row.error) lines.push(`Error: ${row.error}`);
            return lines.join("\n");
        },
    };

    PQ.Progress = Progress;
    PQ.Format = Format;
    window.Progress = Progress;
    window.Format = Format;
})();


