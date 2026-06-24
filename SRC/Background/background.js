import { GetOrCreateWorkerWindow } from "../Worker/worker_windowManager.js";

const MAX_RUNNING_DOWNLOADS = 6;

const STUCK_MS = 11000;
const CHECK_MS = 700;
const STATUS_HISTORY_SIZE = 5;

const queue = [];
const runningJobs = new Map();
const watches = new Map();

let nextJobId = 1;

console.log("background start");

const MENU_ID_DOWNLOAD_LINK = "download-link-with-manager";

///////////////////////////////////////////////////////////////////////////////////////////////////
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: MENU_ID_DOWNLOAD_LINK,
        title: "リンク先のDownloadを実行",
        contexts: ["link"],
        documentUrlPatterns: [
            "*://hitomi.la/*",
            "*://*.hitomi.la/*"
        ]
    });
});

///////////////////////////////////////////////////////////////////////////////////////////////////
// コンテキストメニューの「リンク先のDownloadを実行」がクリックされたときのプロシージャー
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== MENU_ID_DOWNLOAD_LINK) return;
    if (!info.linkUrl) return;

    const job = {
        id: nextJobId++,
        url: info.linkUrl,
        tabId: null,
        title: null,
        status: "opening",
        resolveDone: null,
        rejectDone: null
    };

    queue.push(job);
    console.log("[Hitomi] queued =", job);

    await openWorkerTabForJob(job);

    job.status = "waiting";
    console.log("[Hitomi] waiting =", job);

    processQueue();
});

///////////////////////////////////////////////////////////////////////////////////////////////////
async function cleanupWorkerTabs(workerWindowId) {
    const tabs = await chrome.tabs.query({ windowId: workerWindowId });
    if (tabs.length <= 0) {
        console.log("[Hitomi] skip cleanup. only one tab");
        return;
    }

    try {
        tabs = await chrome.tabs.query({ windowId: workerWindowId });
    }
    catch (e) {
        console.warn("[Hitomi] cleanup skipped. worker window missing =", workerWindowId);
        return;
    }

    for (const tab of tabs) {
        const isManaged =
            queue.some(job => job.tabId === tab.id) ||
            [...runningJobs.values()].some(job => job.tabId === tab.id) ||
            watches.has(tab.id);

        const isGarbage =
            tab.url === "chrome://newtab/" ||
            tab.url === "about:blank" ||
            tab.title === "新しいタブ" ||
            tab.title === "New Tab";

        if (!isManaged || isGarbage) {
            try {
                await chrome.tabs.remove(tab.id);
                console.log("[Hitomi] cleanup tab =", tab.id, tab.title, tab.url);
            }
            catch (e) {
                console.warn("[Hitomi] cleanup failed =", tab.id, e);
            }
        }
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// workerのタブだけはさきに開けておく。
async function openWorkerTabForJob(job) {
    const workerWindowId = await GetOrCreateWorkerWindow();
    await cleanupWorkerTabs(workerWindowId);

    const workerTab = await chrome.tabs.create({
        windowId: workerWindowId,
        url: job.url,
        active: false
    });

    job.tabId = workerTab.id;

    console.log("[Hitomi] workerTab opened =", job);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// FIFO待機列を監視し、
// 同時実行数に空きがあれば次のJobを開始する。
// Job完了後は自分自身を再度呼び出し、
// 次の待機Jobへ処理を引き継ぐ。
async function processQueue() {
    if (runningJobs.size >= MAX_RUNNING_DOWNLOADS) return;

    const job = queue.find(x => x.status === "waiting");
    if (!job) return;

    runningJobs.set(job.id, job);
    job.status = "running";

    console.log("[Hitomi] start download =", job);

    try {
        await runDownloadJob(job);

        job.status = "done";
        console.log("[Hitomi] done job =", job);
    }
    catch (err) {
        job.status = "error";
        console.error("[Hitomi] error job =", job, err);
    }
    finally {
        runningJobs.delete(job.id);
        stopWatch(job.tabId);

        if (job.tabId) {
            try {
                await chrome.tabs.remove(job.tabId);
                console.log("[Hitomi] tab closed =", job.tabId);
            }
            catch (e) {
                console.warn("[Hitomi] tab close failed =", job.tabId, e);
            }
        }

        processQueue();
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// 単一のDownload Jobを実行する。
// Worker Window上に専用Tabを生成し、
// Hitomiページへ移動してDownloadボタンを押下する。
// その後 webRequest を監視し、正常終了または通信停止を判定する。
async function runDownloadJob(job) {
    console.log("[Hitomi] workerTabId =", job.tabId);

    if (!job.tabId) {
        throw new Error("job.tabId is missing");
    }

    startWatch(job);

    await sleep(1000);

    const [pageInfo] = await chrome.scripting.executeScript({
        target: { tabId: job.tabId },
        func: () => ({
            title: document.title,
            url: location.href
        })
    });

    job.title = pageInfo.result.title;

    console.log("[Hitomi] pageInfo =", pageInfo.result);

    const [downloadCandidates] = await chrome.scripting.executeScript({
        target: { tabId: job.tabId },
        func: () => {
            return [...document.querySelectorAll("a, button")]
                .map(el => ({
                    tag: el.tagName,
                    text: el.textContent?.trim(),
                    href: el.href || null,
                    id: el.id || null,
                    className: el.className || null
                }))
                .filter(x =>
                    (x.text && x.text.toLowerCase().includes("download")) ||
                    (x.href && x.href.toLowerCase().includes("download"))
                );
        }
    });

    console.log("[Hitomi] download candidates =", downloadCandidates.result);

    const [clickResult] = await chrome.scripting.executeScript({
        target: { tabId: job.tabId },
        func: () => {
            const btn = document.querySelector("#dl-button");

            if (!btn) {
                return { ok: false, reason: "dl-button not found" };
            }

            btn.click();

            return {
                ok: true,
                text: btn.textContent?.trim(),
                href: btn.href
            };
        }
    });

    console.log("[Hitomi] clickResult =", clickResult.result);

    if (!clickResult.result?.ok) {
        throw new Error(clickResult.result?.reason || "download click failed");
    }

    await waitJobDone(job);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// Job完了まで待つ。
// startWatch側が正常終了を検知したら resolve される。
function waitJobDone(job) {
    return new Promise((resolve, reject) => {
        job.resolveDone = resolve;
        job.rejectDone = reject;
    });
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// 指定Jobの通信監視を開始する。
// webRequestの成功履歴を見て、通信停止や正常終了を判定する。
function startWatch(job) {
    stopWatch(job.tabId);

    const watch = {
        job,
        tabId: job.tabId,
        lastSuccessTime: null,
        recentStatuses: [],
        stuckReported: false,
        timerId: null
    };

    watch.timerId = setInterval(() => {
        checkSilent(job.tabId);
    }, CHECK_MS);

    watches.set(job.tabId, watch);

    console.log(`[Hitomi][tab:${job.tabId}] watch started`);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// 指定Tabの通信監視を停止する。
function stopWatch(tabId) {
    if (!tabId) return;

    const watch = watches.get(tabId);
    if (!watch) return;

    clearInterval(watch.timerId);
    watches.delete(tabId);

    console.log(`[Hitomi][tab:${tabId}] watch stopped`);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// 一定時間 200 成功通信が無い場合、
// last5が全部200なら正常終了、そうでなければ復活の呪文を唱える。
function checkSilent(tabId) {
    const watch = watches.get(tabId);
    if (!watch) return;
    if (watch.lastSuccessTime === null) return;

    const silentMs = Date.now() - watch.lastSuccessTime;
    if (silentMs < STUCK_MS) return;

    console.log(
        `[Hitomi][tab:${tabId}] silent=${Math.round(silentMs / 1000)}s last5=${watch.recentStatuses.join(",")}`
    );

    const allLast5Are200 =
        watch.recentStatuses.length === STATUS_HISTORY_SIZE &&
        watch.recentStatuses.every(status => status === 200);

    if (allLast5Are200) {
        console.log(`[Hitomi][tab:${tabId}] normal finish detected`);

        const job = watch.job;
        job.resolveDone?.();

        return;
    }

    reportStuck(tabId, `no-success-${Math.round(silentMs / 1000)}s last5=${watch.recentStatuses.join(",")}`);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// 通信停止扱いにして、復活の呪文を唱える。
async function reportStuck(tabId, reason) {
    const watch = watches.get(tabId);
    if (!watch || watch.stuckReported) return;

    watch.stuckReported = true;

    console.log(`[Hitomi][tab:${tabId}] stuck detected reason=${reason}`);

    await castRescueSpell(tabId);

    watch.stuckReported = false;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// 復活の呪文。
// Worker Tab内で #dl-button を再クリックする。
async function castRescueSpell(tabId) {
    console.log(`[Hitomi][tab:${tabId}] rescue spell`);

    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                const button = document.querySelector("#dl-button");

                if (!button) {
                    console.log("[Hitomi] #dl-button not found");
                    return;
                }

                button.click();
            }
        });
    }
    catch (error) {
        console.log(`[Hitomi][tab:${tabId}] rescue failed: ${error.message}`);
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// 通信ステータス履歴を最大 STATUS_HISTORY_SIZE 件だけ保持する。
function pushStatus(watch, status) {
    watch.recentStatuses.push(status);

    if (watch.recentStatuses.length > STATUS_HISTORY_SIZE) {
        watch.recentStatuses.shift();
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
// Hitomiの画像通信だけを監視対象にする。
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

///////////////////////////////////////////////////////////////////////////////////////////////////
chrome.webRequest.onCompleted.addListener(
    details => {
        if (details.tabId < 0) return;

        const watch = watches.get(details.tabId);
        if (!watch) return;
        if (!isTargetWebpXhr(details)) return;

        pushStatus(watch, details.statusCode);

        if (details.statusCode === 200) {
            watch.lastSuccessTime = Date.now();
            watch.stuckReported = false;

            console.log(
                `[Hitomi][tab:${details.tabId}] 200 success last5=${watch.recentStatuses.join(",")}`
            );
        }
        else {
            console.log(`[Hitomi][tab:${details.tabId}] status=${details.statusCode}`);
        }
    },
    { urls: ["<all_urls>"] }
);

///////////////////////////////////////////////////////////////////////////////////////////////////
chrome.webRequest.onErrorOccurred.addListener(
    details => {
        if (details.tabId < 0) return;

        const watch = watches.get(details.tabId);
        if (!watch) return;
        if (!isTargetWebpXhr(details)) return;

        pushStatus(watch, "ERROR");

        console.log(`[Hitomi][tab:${details.tabId}] error=${details.error}`);
    },
    { urls: ["<all_urls>"] }
);