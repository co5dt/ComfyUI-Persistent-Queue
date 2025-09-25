(function () {
    "use strict";

    const PQ = window.PQueue = window.PQueue || {};

    const state = {
        paused: false,
        queue_running: [],
        queue_pending: [],
        db_pending: [],
        history: [],
        running_progress: {},
        workflowCache: new Map(),
        durationByWorkflow: new Map(),
        dbIndex: new Map(),
        workflowNameCache: new Map(),
        selectedPending: new Set(),
        filters: {
            pending: "",
            historySince: "",
            historyUntil: "",
            historySinceTime: "",
            historyUntilTime: "",
        },
        historyTotal: null,
        historyIds: new Set(),
        historyPaging: {
            isLoading: false,
            hasMore: true,
            nextCursor: null,
            params: { sort_by: "id", sort_dir: "desc", limit: 60 },
        },
        metrics: {
            runningCount: 0,
            queueCount: 0,
            persistedCount: 0,
            historyCount: 0,
            successRate: null,
            avgDuration: null,
            estimatedTotalDuration: null,
            estimatedPendingDuration: null,
            estimatedRunningDuration: null,
            failureCount: 0,
            lastFailure: null,
        },
        isRefreshing: false,
        renderLockUntil: 0,
        anchorLockDepth: 0,
        anchorSnapshot: null,
        lastUpdated: null,
        error: null,
        statusMessage: null,
        statusTimer: null,
        container: null,
        dom: {},
    };

    PQ.state = state;
    PQ.vars = {
        pollIntervalId: null,
        focusListener: null,
        dragRow: null,
        dropHover: null,
    };
})();


