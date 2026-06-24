let workerWindowId = null;

export async function GetOrCreateWorkerWindow() {
    if (workerWindowId) {
        try {
            await chrome.windows.get(workerWindowId);
            return workerWindowId;
        }
        catch {
            console.warn("[Hitomi] stale workerWindowId =", workerWindowId);
            workerWindowId = null;
        }
    }

    const win = await chrome.windows.create({
        state: "minimized",
        focused: false
    });

    workerWindowId = win.id;
    console.log("[Hitomi] worker window created =", workerWindowId);

    return workerWindowId;
}