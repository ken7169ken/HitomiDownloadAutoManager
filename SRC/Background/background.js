console.log("background start");

///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "DOWNLOAD_BLOB_URL") return false;

    chrome.downloads.download({
        url: message.url,
        filename: message.filename || "HitomiTest/0001.webp",
        conflictAction: "overwrite"
    }, downloadId => {
        if (chrome.runtime.lastError) {
            console.error("[Background] download error =", chrome.runtime.lastError.message);
            sendResponse({
                ok: false,
                error: chrome.runtime.lastError.message
            });
            return;
        }

        console.log("[Background] download id =", downloadId, message.filename);

        sendResponse({
            ok: true,
            downloadId
        });
    });

    return true;
});