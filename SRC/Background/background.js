// JavaScript source code
const watches = new Map();

const STUCK_MS = 11000;
const CHECK_MS = 700;
const STATUS_HISTORY_SIZE = 5;

const RESCUE_OBSERVE_MS = 10000;
const MAX_ACTIVE_PLAYERS = 5;

const rescueQueue = [];
const queuedTabs = new Set();
const activePlayers = new Set();

let rescueBusy = false;

chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "start-hitomi-watch") return;

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tab?.id) return;

    startWatch(tab.id);
});

chrome.webRequest.onCompleted.addListener(
    (details) => {
        if (details.tabId < 0) return;

        const watch = watches.get(details.tabId);
        if (!watch) return;
        if (!isTargetWebpXhr(details)) return;

        pushStatus(watch, details.statusCode);

        if (details.statusCode === 200) {
            watch.lastSuccessTime = Date.now();
            watch.stuckReported = false;

            activePlayers.add(details.tabId);

            console.log(
                `[HitomiRescue][tab:${details.tabId}] 🟢 200 success active=${activePlayers.size}/${MAX_ACTIVE_PLAYERS}`
            );
        } else {
            console.log(`[HitomiRescue][tab:${details.tabId}] 🔴 status=${details.statusCode}`);
        }
    },
    { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
        if (details.tabId < 0) return;

        const watch = watches.get(details.tabId);
        if (!watch) return;
        if (!isTargetWebpXhr(details)) return;

        pushStatus(watch, "ERROR");

        console.log(`[HitomiRescue][tab:${details.tabId}] ❌ error=${details.error}`);
    },
    { urls: ["<all_urls>"] }
);

function startWatch(tabId) {
    stopWatch(tabId);

    const watch = {
        tabId,
        lastSuccessTime: null,
        recentStatuses: [],
        stuckReported: false,
        timerId: null
    };

    watch.timerId = setInterval(() => {
        checkSilent(tabId);
    }, CHECK_MS);

    watches.set(tabId, watch);

    console.log(`[HitomiRescue][tab:${tabId}] 👀 watch started`);
}

function stopWatch(tabId) {
    const watch = watches.get(tabId);
    if (!watch) return;

    clearInterval(watch.timerId);
    watches.delete(tabId);

    queuedTabs.delete(tabId);
    activePlayers.delete(tabId);

    console.log(`[HitomiRescue][tab:${tabId}] 🛑 watch stopped active=${activePlayers.size}/${MAX_ACTIVE_PLAYERS}`);
}

function checkSilent(tabId) {
    const watch = watches.get(tabId);
    if (!watch) return;
    if (watch.lastSuccessTime === null) return;

    const silentMs = Date.now() - watch.lastSuccessTime;
    if (silentMs < STUCK_MS) return;

    const allLast5Are200 =
        watch.recentStatuses.length === STATUS_HISTORY_SIZE &&
        watch.recentStatuses.every(status => status === 200);

    if (allLast5Are200) {
        console.log(
            `[HitomiRescue][tab:${tabId}] 🎉 正常終了っぽい。last5=${watch.recentStatuses.join(",")}`
        );

        stopWatch(tabId);
        pumpRescueQueue();
        return;
    }

    reportStuck(
        tabId,
        `no-success-${Math.round(silentMs / 1000)}s last5=${watch.recentStatuses.join(",")}`
    );
}

function reportStuck(tabId, reason) {
    const watch = watches.get(tabId);
    if (!watch || watch.stuckReported) return;

    watch.stuckReported = true;
    activePlayers.delete(tabId);

    console.log(
        `[HitomiRescue][tab:${tabId}] 🚑💥🩸😱 通信血栓！退場 active=${activePlayers.size}/${MAX_ACTIVE_PLAYERS} reason=${reason}`
    );

    chrome.tabs.sendMessage(tabId, {
        type: "HITOMI_STUCK",
        reason
    }).catch(() => {});

    enqueueRescue(tabId, reason);
}

function enqueueRescue(tabId, reason) {
    if (queuedTabs.has(tabId)) {
        console.log(`[HitomiRescue][tab:${tabId}] 🪑 既に待合室`);
        return;
    }

    queuedTabs.add(tabId);
    rescueQueue.push({ tabId, reason });

    console.log(
        `[HitomiRescue][tab:${tabId}] 🪑 待合室入り queue=${rescueQueue.length} active=${activePlayers.size}/${MAX_ACTIVE_PLAYERS}`
    );

    pumpRescueQueue();
}

async function pumpRescueQueue() {
    if (rescueBusy) return;

    rescueBusy = true;

    try {
        while (
            rescueQueue.length > 0 &&
            activePlayers.size < MAX_ACTIVE_PLAYERS
        ) {
            const patient = rescueQueue.shift();
            queuedTabs.delete(patient.tabId);

            const watch = watches.get(patient.tabId);
            if (!watch) continue;

            console.log(
                `[HitomiRescue][tab:${patient.tabId}] 🩺 診察開始 queue=${rescueQueue.length} active=${activePlayers.size}/${MAX_ACTIVE_PLAYERS}`
            );

            await castRescueSpell(patient.tabId);

            activePlayers.add(patient.tabId);

            console.log(
                `[HitomiRescue][tab:${patient.tabId}] 🏟️ プレーグラウンド復帰 active=${activePlayers.size}/${MAX_ACTIVE_PLAYERS}`
            );

            console.log(
                `[HitomiRescue][tab:${patient.tabId}] 🛌 安定観察 ${RESCUE_OBSERVE_MS / 1000}s`
            );

            await sleep(RESCUE_OBSERVE_MS);
        }
    } finally {
        rescueBusy = false;
    }
}

async function castRescueSpell(tabId) {
    console.log(`[HitomiRescue][tab:${tabId}] 🪄✨⚡ 復活の呪文 Ctrl+Shift+5 代理発火！`);

    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                console.log(
                    "%c🪄✨⚡ 復活の呪文を唱えた！",
                    "color:lime;font-size:22px;font-weight:bold;"
                );

                const button = document.querySelector("#dl-button");

                if (!button) {
                    console.log("[HitomiRescue] #dl-button が見つからない");
                    return;
                }

                button.click();
            }
        });
    } catch (error) {
        console.log(`[HitomiRescue][tab:${tabId}] 復活の呪文失敗: ${error.message}`);
    }
}

function pushStatus(watch, status) {
    watch.recentStatuses.push(status);

    if (watch.recentStatuses.length > STATUS_HISTORY_SIZE) {
        watch.recentStatuses.shift();
    }
}

function isTargetWebpXhr(details) {
    return (
        details.type === "xmlhttprequest" &&
        details.url.includes(".webp") &&
        (
            details.url.includes("w1.gold-usergeneratedcontent.net") ||
            details.url.includes("w2.gold-usergeneratedcontent.net")
        )
    );
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}