let isF13Down = false;
let capturedLink = null;
let ggCache = null;

///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
window.addEventListener("keydown", e => {
    if (e.key === "F13") isF13Down = true;
}, true);

window.addEventListener("keyup", e => {
    if (e.key === "F13") isF13Down = false;
}, true);

///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
document.addEventListener("mousedown", e => {
    if (!isF13Down) return;
    if (e.button !== 0) return;

    const link = e.target.closest("a");
    if (!link?.href) return;

    capturedLink = link;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
}, true);

//----- - ----- - ----- - ----- - ----- - ----- - -----
document.addEventListener("mouseup", async e => {
    if (!capturedLink) return;
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const pageUrl = capturedLink.href;
    capturedLink = null;

    console.log("[Hitomi] queue url =", pageUrl);

    try {
        await downloadAllPagesFromHitomiPage(pageUrl);
    }
    catch (error) {
        console.error("[Hitomi] download failed =", error);
    }
}, true);

///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
document.addEventListener("click", e => {
    if (!capturedLink && !isF13Down) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
}, true);

///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
function extractGalleryId(url) {
    return url.match(/-(\d+)\.html/)?.[1] ?? null;
}

//----- - ----- - ----- - ----- - ----- - ----- - -----
async function fetchGalleryInfo(galleryId) {
    const url = `https://ltn.gold-usergeneratedcontent.net/galleries/${galleryId}.js`;

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to fetch gallery info: ${res.status}`);
    }

    const text = await res.text();
    const jsonText = text.replace("var galleryinfo = ", "");

    return JSON.parse(jsonText);
}

//----- - ----- - ----- - ----- - ----- - ----- - -----
async function fetchGG() {
    if (ggCache) return ggCache;

    const url = "https://ltn.gold-usergeneratedcontent.net/gg.js";
    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(`Failed to fetch gg.js: ${res.status}`);
    }

    const body = await res.text();

    const mDefault = Number(body.match(/var o = (\d)/)?.[1] ?? 0);
    const o = Number(body.match(/o = (\d); break;/)?.[1] ?? mDefault);
    const b = body.match(/b: '(.+)'/)?.[1] ?? "";

    const mMap = new Map();
    for (const m of body.matchAll(/case (\d+):/g)) {
        mMap.set(Number(m[1]), o);
    }

    ggCache = { mDefault, mMap, b };

    console.log("[HitomiDirect] gg =", ggCache);

    return ggCache;
}

//----- - ----- - ----- - ----- - ----- - ----- - -----
function ggS(hash) {
    const m = hash.match(/(..)(.)$/);
    if (!m) throw new Error(`Invalid hash: ${hash}`);

    return parseInt(m[2] + m[1], 16).toString();
}

//----- - ----- - ----- - ----- - ----- - ----- - -----
async function fullPathFromHash(hash) {
    const gg = await fetchGG();
    return `${gg.b}${ggS(hash)}/${hash}`;
}

//----- - ----- - ----- - ----- - ----- - ----- - -----
async function imageUrlFromHash(image, ext = "webp") {
    const path = await fullPathFromHash(image.hash);
    const url = `https://a.gold-usergeneratedcontent.net/${path}.${ext}`;

    return rewriteImageUrl(url, ext);
}

//----- - ----- - ----- - ----- - ----- - ----- - -----
async function rewriteImageUrl(url, dir) {
    const gg = await fetchGG();

    const m = url.match(/\/[0-9a-f]{61}([0-9a-f]{2})([0-9a-f])/);
    if (!m) return url;

    const g = parseInt(m[2] + m[1], 16);
    const prefix = dir === "avif" ? "a" : "w";
    const sub = prefix + (1 + (gg.mMap.get(g) ?? gg.mDefault));

    return url.replace(
        /\/\/..?\.(?:gold-usergeneratedcontent\.net|hitomi\.la)\//,
        `//${sub}.gold-usergeneratedcontent.net/`
    );
}

///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
async function registerDownloadJob(title, pageUrl, items) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: "REGISTER_DOWNLOAD_JOB",
            title,
            pageUrl,
            items
        }, response => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            if (!response?.ok) {
                reject(new Error(response?.error || "register job failed"));
                return;
            }

            console.log("[HitomiDirect] job registered =", response.jobId);
            resolve(response);
        });
    });
}

///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////
/*
async function downloadAllPagesFromHitomiPage(pageUrl) {
    const galleryId = extractGalleryId(pageUrl);
    if (!galleryId) {
        throw new Error("galleryId not found");
    }

    const galleryInfo = await fetchGalleryInfo(galleryId);

    console.log("[HitomiDirect] title =", galleryInfo.title);
    console.log("[HitomiDirect] pages =", galleryInfo.files.length);

    const zip = new JSZip();

    for (let i = 0; i < galleryInfo.files.length; i++) {
        const file = galleryInfo.files[i];
        const pageNumber = i + 1;
        const pageName = String(pageNumber).padStart(4, "0");

        const imageUrl = await imageUrlFromHash(file, "webp");

        console.log(
            `[HitomiDirect] ${pageNumber}/${galleryInfo.files.length} url =`,
            imageUrl
        );

        const res = await fetch(imageUrl);

        console.log(`[HitomiDirect] ${pageNumber}/${galleryInfo.files.length} status =`, res.status, res.headers.get("content-type"));

        if (!res.ok) {
            console.error(`[HitomiDirect] fetch failed ${pageNumber}:`, await res.text());
            continue;
        }

        const blob = await res.blob();
        zip.file(`${pageName}.webp`, blob);
        console.log(`[HitomiDirect] ${pageNumber}/${galleryInfo.files.length} added to zip`);
        await sleep(150);
    }

    console.log("[HitomiDirect] generating zip...");

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const zipUrl = URL.createObjectURL(zipBlob);
    const title = sanitizeFileName(titleFromHitomiPageUrl(pageUrl));

    //await sendDownloadBlob(zipUrl, `HitomiTest/${title}.zip`);
    await sendDownloadBlob(zipUrl, `${title}.zip`);

    setTimeout( () => {URL.revokeObjectURL(zipUrl); }, 60_000 );

    console.log("[HitomiDirect] zip completed");
}

async function downloadAllPagesFromHitomiPage(pageUrl) {
    const galleryId = extractGalleryId(pageUrl);
    if (!galleryId) throw new Error("galleryId not found");

    const galleryInfo = await fetchGalleryInfo(galleryId);

    console.log("[HitomiDirect] title =", galleryInfo.title);
    console.log("[HitomiDirect] pages =", galleryInfo.files.length);

    const title = sanitizeFileName(titleFromHitomiPageUrl(pageUrl));

    const items = [];

    for (let i = 0; i < galleryInfo.files.length; i++) {
        const file = galleryInfo.files[i];
        const pageNumber = i + 1;
        const pageName = String(pageNumber).padStart(4, "0");

        const imageUrl = await imageUrlFromHash(file, "webp");

        items.push({
            index: i,
            url: imageUrl,
            filename: `${title}/${pageName}.webp`
        });

        console.log(`[HitomiDirect] ${pageNumber}/${galleryInfo.files.length} registered url =`, imageUrl);
    }

    if (items.length > 0) {
        try {
            const res = await fetch(items[0].url);
            console.log("[HitomiDirect] fetch test =", res.status, res.headers.get("content-type"));
        } catch (error) {
            console.error("[HitomiDirect] fetch test failed =", error);
        }
    }

    await registerDownloadJob(title, pageUrl, items);

    console.log("[HitomiDirect] job registered, download will be handled by background");
}
*/
async function downloadAllPagesFromHitomiPage(pageUrl) {
    const galleryId = extractGalleryId(pageUrl);
    if (!galleryId) throw new Error("galleryId not found");

    const galleryInfo = await fetchGalleryInfo(galleryId);

    console.log("[HitomiDirect] title =", galleryInfo.title);
    console.log("[HitomiDirect] pages =", galleryInfo.files.length);

    const title = sanitizeFileName(titleFromHitomiPageUrl(pageUrl));
    const items = [];

    for (let i = 0; i < galleryInfo.files.length; i++) {
        const file = galleryInfo.files[i];
        const pageNumber = i + 1;
        const pageName = String(pageNumber).padStart(4, "0");

        const imageUrl = await imageUrlFromHash(file, "webp");

        items.push({
            index: i,
            url: imageUrl,
            filename: `${title}/${pageName}.webp`
        });

        console.log(`[HitomiDirect] ${pageNumber}/${galleryInfo.files.length} registered url =`, imageUrl);
    }

    const registered = await registerDownloadJob(title, pageUrl, items);
    const jobId = registered.jobId;

    console.log("[HitomiDirect] job registered =", jobId);

    for (const item of items) {
        // 鯖からの画像ファイルが入ったレスポンス。fetch() が content.js の中なら 200 image/webp を返す。
        // つまり、ページ上にいる間は、ブラウザが持っているCookieやRefererなどの文脈のおかげで画像を正常に取得できる。
        // 一方で background から直接 fetch() すると、404 text/html となる。
        // 作品URL
        // 画像URL一覧
        // Cookie
        // Referer
        // User-Agent
        const res = await fetch(item.url);
        console.log("[HitomiDirect] fetch blob =", item.index + 1, res.status, res.headers.get("content-type"));

        if (!res.ok) {
            console.error("[HitomiDirect] fetch failed =", item.filename, res.status);
            continue;
        }

        // HTTPレスポンス → 画像データだけ取り出す → Blob
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);

        await sendDownloadBlob(blobUrl, item.filename);

        setTimeout(() => {
            URL.revokeObjectURL(blobUrl);
        }, 60_000);

        console.log("[HitomiDirect] blob download requested =", item.filename);

        //await sleep(150);
    }

    setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
    }, 60_000);

    console.log("[HitomiDirect] one blob download requested =", item.filename);
}

//----- - ----- - ----- - ----- - ----- - ----- - -----
function sendDownloadBlob(blobUrl, filename) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: "DOWNLOAD_BLOB_URL",
            url: blobUrl,
            filename
        }, response => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            if (!response?.ok) {
                reject(new Error(response?.error || "download failed"));
                return;
            }

            console.log("[HitomiDirect] download queued =", filename, response.downloadId);
            resolve(response);
        });
    });
}

//----- - ----- - ----- - ----- - ----- - ----- - -----
function titleFromHitomiPageUrl(pageUrl) {
    const url = new URL(pageUrl);
    const last = url.pathname.split("/").pop();

    if (!last) return "untitled";

    let title = decodeURIComponent(last.replace(/\.html$/i, ""));

    // "-日本語-3420295" を削除
    title = title.replace(/-[^-]+-\d+$/i, "");

    return title;
}

//----- - ----- - ----- - ----- - ----- - ----- - -----
function sanitizeFileName(name) {
    return name
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, " ")
        .trim();
}

//----- - ----- - ----- - ----- - ----- - ----- - -----
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}