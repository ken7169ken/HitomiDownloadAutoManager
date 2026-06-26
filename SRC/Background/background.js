console.log("background start");

///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "REGISTER_DOWNLOAD_JOB") {
        (async () => {
            try {
                const jobInfo = {
                    id: crypto.randomUUID(),
                    title: message.title ?? "Untitled",
                    pageUrl: message.pageUrl ?? sender.tab?.url ?? "",
                    items: message.items ?? [],
                    status: "queued",
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    currentIndex: 0,
                    done: [],
                    failed: []
                };

                await chrome.storage.local.set({
                    [`job:${jobInfo.id}`]: jobInfo,
                    currentJobId: jobInfo.id
                });

                sendResponse({ ok: true, jobId: jobInfo.id });
            } catch (error) {
                sendResponse({
                    ok: false,
                    error: String(error?.message ?? error)
                });
            }
        })();

        return true;
    }

    if (message.type === "DOWNLOAD_BLOB_URL") {
        chrome.downloads.download({
            url: message.url,
            filename: message.filename,
            conflictAction: "overwrite"
        }, downloadId => {
            if (chrome.runtime.lastError || !downloadId) {
                sendResponse({
                    ok: false,
                    error: chrome.runtime.lastError?.message ?? "downloadId not returned"
                });
                return;
            }

            console.log("[Background] blob download queued =", downloadId, message.filename);

            sendResponse({
                ok: true,
                downloadId
            });
        });

        return true;
    }
});
///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
async function startDownloadJob(jobId)
{
    const key = `job:${jobId}`;

    const result = await chrome.storage.local.get(key);
    const job = result[key];
    if (!job) return;

    for (const item of job.items) downloadOneJob(jobId, item);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
async function downloadOneJob(jobId, item) {
    const key = `job:${jobId}`;
    console.log("[Background] download url =", item.url);

    /*
    try {
        const res = await fetch(item.url);
        console.log("[Background] fetch test =", res.status, res.headers.get("content-type"));
    } catch (error) {
        console.error("[Background] fetch test failed =", error);
    }
    */

    chrome.downloads.download({url: item.url, filename: item.filename, conflictAction: "overwrite"}, async downloadId => {
        const result = await chrome.storage.local.get(key);
        const job = result[key];
        if (!job) return;

        if (chrome.runtime.lastError || !downloadId) {
            console.error("[Background] download start failed =", chrome.runtime.lastError?.message);

            await chrome.storage.local.set({[key]: {
                ...job,
                status: "failed",
                failed: [...(job.failed ?? []), item.index],
                error: chrome.runtime.lastError?.message ?? "downloadId not returned",
                updatedAt: Date.now()
            }});

            return;
        }

        await chrome.storage.local.set({[key]: {...job, status: "downloading", updatedAt: Date.now()}});
        console.log("[Background] download queued =", downloadId, item.filename);
    });
}

///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
chrome.downloads.onChanged.addListener(delta => {
    if (!delta.state) return;
    if (delta.state.current !== "complete" && delta.state.current !== "interrupted") return;

    if (delta.state) console.log("[Background] download state =", delta.id, delta.state.current);
    if (delta.error) console.error("[Background] download error =", delta.id, delta.error.current);

    chrome.storage.local.get(null, result => {
        const entry = Object.entries(result).find(([key, job]) =>
            key.startsWith("job:") && job.downloadId === delta.id
        );

        if (!entry) return;

        const [key, job] = entry;

        if (delta.state.current === "complete") {
            chrome.storage.local.remove(key);
            console.log("[Background] job complete and removed =", key);
            return;
        }

        chrome.storage.local.set({
            [key]: {
                ...job,
                status: "failed",
                error: "interrupted",
                updatedAt: Date.now()
            }
        });
    });
});