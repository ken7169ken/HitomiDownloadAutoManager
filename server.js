/*
【シーケンスフォロー】
    enqueue → runQueue → runJob → page.goto() → title取得
*/
/////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////
// Global consts & values
// Version
const hitomi_server_ver = "ver 2.0.0";

// Modules
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { chromium } = require("playwright");

// Settings
const PORT = 18765;
const MAX_CONCURRENT_JOBS = 4;

// Runtime State
const queue = [];

let activeCount = 0;
let browserReadyPromise = null;
let browser = null;
let context = null;

// Console UI
let jobLineCount = 0;

//@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
//@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
//@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
//@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
// for Debug
const LOG_DIR = "Log";
fs.mkdirSync(LOG_DIR, { recursive: true });
const consoleCursor = { liveLineReady: false };
const char_num = 87; // 標準情報プラス何文字をライブ・ラインに出すか？
const ANSI_BLUE  = "\x1b[36m";   // シアン寄り
const ANSI_RESET = "\x1b[0m";

//---------------------------------------------- - ----------------------------------------------
const DEBUG_LOG = path.join(
    LOG_DIR,
    createTimestampForFileName() + ".log"
);

//---------------------------------------------- - ----------------------------------------------
function createTimestampForFileName() {
    const d = new Date();

    const pad = n => String(n).padStart(2, "0");

    return [
        d.getFullYear(),
        pad(d.getMonth() + 1),
        pad(d.getDate())
    ].join("-")
    + "_"
    + [
        pad(d.getHours()),
        pad(d.getMinutes()),
        pad(d.getSeconds())
    ].join("-");
}

/////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////
function debug(...args)
{
    const line =
        `[${new Date().toISOString()}] ` +
        args.map(v =>
            typeof v === "string"
                ? v
                : JSON.stringify(v)
        ).join(" ")
        + "\n";

    fs.appendFileSync(DEBUG_LOG, line);

    readline.moveCursor(process.stdout, 0, 1);
    
    writeLiveLogLine(createLiveLogText(args));
    
    readline.moveCursor(process.stdout, 0, -1);
    readline.cursorTo(process.stdout, 0);
}

//---------------------------------------------- - ----------------------------------------------
function writeLiveLogLine(text) {
    if (!process.stdout.isTTY) return;

    const width = process.stdout.columns || 80;
    const safeWidth = Math.min(80, Math.max(20, width - 4));

    let oneLine = text
        .replace(/\r?\n/g, " ")
        .replace(/\s+/g, " ");

    if (oneLine.length > safeWidth) {
        oneLine = oneLine.slice(0, safeWidth - 1) + "…";
    }

    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(
        ANSI_BLUE +
        oneLine.padEnd(safeWidth, " ") +
        ANSI_RESET
    );
}

//---------------------------------------------- - ----------------------------------------------
function createLiveLogText(args) {
    const time = new Date().toISOString();
    const tag = typeof args[0] === "string" ? args[0] : "[LOG]";

    // 日時 + タグ + 本文23文字
    const body = args
        .slice(1)
        .map(v => typeof v === "string" ? v : JSON.stringify(v))
        .join(" ")
        .replace(/\r?\n/g, " ")
        .replace(/\s+/g, " ")
        .slice(0, char_num);

    //return `[${time}] ${tag} ${body}…`;
    //return `${tag} ${body}…`;
    return `${body}…`;
}

//@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
//@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
//@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
//@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
function printJobLine(job, mark) {
    if (consoleCursor.liveLineReady) {
        readline.moveCursor(process.stdout, 0, 1);
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
        readline.moveCursor(process.stdout, 0, -1);

        consoleCursor.liveLineReady = false;
    }

    job.lineIndex = jobLineCount++;

    process.stdout.write(`${mark} ${job.title}\n`);

    consoleCursor.liveLineReady = true;
}

//---------------------------------------------- - ----------------------------------------------
function updateJobLine(job, mark) {
    if (!process.stdout.isTTY || job.lineIndex == null) {
        console.log(mark, job.title);
        return;
    }

    const moveUp = jobLineCount - job.lineIndex;

    readline.moveCursor(process.stdout, 0, -moveUp);
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);

    process.stdout.write(`${mark} ${job.title}`);

    readline.moveCursor(process.stdout, 0, moveUp);
    //if (consoleCursor.liveLineReady) readline.moveCursor(process.stdout, 0, 1);
    readline.cursorTo(process.stdout, 0);
}

/////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////
async function ensureBrowser() {
    if (browser && context) return;

    if (browserReadyPromise) {
        await browserReadyPromise;
        return;
    }

    browserReadyPromise = (async () => {
        browser = await chromium.launch({
            headless: true
        });

        context = await browser.newContext({
            acceptDownloads: true
        });
    })();

    await browserReadyPromise;
}

/////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////
// const & values
const MAX_RETRY_COUNT = 1;
const RETRY_WAIT_MS = 30_000;

//---------------------------------------------- - ----------------------------------------------
async function enqueue(url) {
    const job = {
        id:        crypto.randomUUID(),
        url,
        title:     extractTitleFromUrl(url),
        status:    "queued",
        createdAt: Date.now(),
        retryCount: 0,
        maxRetryCount: MAX_RETRY_COUNT
    };

    queue.push(job);
    printJobLine(job, "○");
    pumpQueue();

    return job;
}

//---------------------------------------------- - ----------------------------------------------
function extractTitleFromUrl(url) {
    try {
        const u = new URL(url);

        const last = u.pathname.split("/").filter(Boolean).at(-1);

        if (!last) return url;
        let title = decodeURIComponent(last);
        title = title.replace(/-[^-]+-\d+\.html$/, "");

        return title;
    } catch {
        return url;
    }
}

/////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////
const DOWNLOAD_DIR = getChromeDownloadDirectory();

//---------------------------------------------- - ----------------------------------------------
function getChromeDownloadDirectory() {
    const prefPath = path.join(
        os.homedir(),
        "AppData",
        "Local",
        "Google",
        "Chrome",
        "User Data",
        "Default",
        "Preferences"
    );

    try {
        const prefs = JSON.parse(fs.readFileSync(prefPath, "utf8"));
        const dir = prefs?.download?.default_directory;

        if (dir && fs.existsSync(dir)) {
            //console.log("[PW] Chrome download dir =", dir);
            return dir;
        }
    } catch (error) {
        console.warn("[PW] Chrome Preferences read failed =", error.message);
    }

    const fallback = path.join(os.homedir(), "Downloads");
    //console.log("[PW] fallback download dir =", fallback);
    return fallback;
}

/////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////
async function pumpQueue() {
    await ensureBrowser();

    while (activeCount < MAX_CONCURRENT_JOBS && queue.length > 0) {
        const job = queue.shift();

        activeCount++;

        runJob(job)
            .catch(async error => {
                if (shouldRetryJob(error) && job.retryCount < job.maxRetryCount) {
                    job.retryCount++;

                    updateJobLine(job, `↻${job.retryCount}`);
                    debug(
                        "[PW][ZOMBIE RETRY]",
                        job.title,
                        `${job.retryCount}/${job.maxRetryCount}`,
                        error.message
                    );

                    await sleep(RETRY_WAIT_MS);

                    queue.unshift(job);
                    return;
                }

                updateJobLine(job, "×");
                console.error("[PW] job failed =", job.id, error);
            })
            .finally(() => {
                activeCount--;

                if (queue.length > 0) {
                    pumpQueue();
                    return;
                }

                if (activeCount === 0) {
                    readline.moveCursor(process.stdout, 0, 1);
                    readline.cursorTo(process.stdout, 0);
                    console.log("");
                    console.log("◇ queue empty");
                }
            });
    }
}

//---------------------------------------------- - ----------------------------------------------
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

//---------------------------------------------- - ----------------------------------------------
function shouldRetryJob(error) {
    const message = String(error?.message ?? "");

    return (
        error?.name === "TimeoutError" ||
        message.includes("Target page, context or browser has been closed")
    );
}

//@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
//@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
//@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
//@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
async function runJob(job) {
    // for Debug
    let phase = "page.goto";
    let response;

    updateJobLine(job, "●");
    const page = await context.newPage();

    const requestStartMap = new Map();
    attachDebugRunJob(page, job, requestStartMap, () => phase);

    try {
        phase = "page.goto";
        response = await page.goto(job.url, {
            waitUntil: "domcontentloaded",
            timeout: 60_000
        });

        // for Debug
        debug(
            "[PW][GOTO OK]",
            job.title,
            response?.status(),
            response?.url()
        );       

        const title = await page.title();
        debug("[PW] page title =", title);

        phase = "waitForSelector";
        await page.waitForSelector("#dl-button", {
            timeout: 30_000
        });

        phase = "waitForDownload";
        const downloadPromise = page.waitForEvent("download", {
            timeout: 900_000
        });

        phase = "click";
        await page.click("#dl-button");

        phase = "await download";
        const download = await downloadPromise;

        phase = "savePath";
        const savePath = path.join(
            DOWNLOAD_DIR,
            download.suggestedFilename()
        );

        phase = "saveAs";
        await download.saveAs(savePath);
        updateJobLine(job, "★");
    } 
    catch (error) {
        //console.error("[PW] phase   =", phase);
        //console.error("[PW] name    =", error.name);

        debug("[PW] phase   =", phase);
        debug("[PW] name    =", error.name);
        debug("[PW] message =", error.message);
        debug(
            "[PW][JOB ERROR]",
            job.title,
            error.name,
            error.message,
            job.url
        );     
        throw error;
    }
    finally {
        await page.close().catch(() => {});
    }
}

//---------------------------------------------- - ----------------------------------------------
async function attachDebugRunJob(page, job, requestStartMap, getPhase)
{
    page.on("request", req => {
        if (req.isNavigationRequest()) {
            requestStartMap.set(req, Date.now());
            debug("[PW][REQ]", job.title, req.method(), req.url());
        }
    });

    let downloadedImages = 0;
    const totalImages = await page.waitForFunction(() => {
        return window.galleryinfo?.files?.length ?? null; }, { timeout: 60_000 }
    ).then(handle => handle.jsonValue());

    page.on("requestfinished", req => {
        const url = req.url();

        const isHitomiPageImage = req.resourceType() === "xhr" && url.includes("gold-usergeneratedcontent.net") && url.includes(".webp");

        if (!isHitomiPageImage) return;

        downloadedImages++;

        debug(
            "[PW][IMAGE DONE]",
            job.title,
            `${downloadedImages}/${totalImages}`,
            url
        );
    });
    
    page.on("requestfailed", req => {
        const startedAt = requestStartMap.get(req);
        const elapsed = startedAt ? Date.now() - startedAt : "?";

        debug(
            "[PW][REQ FAILED]",
            job.title,
            req.method(),
            req.resourceType(),
            req.isNavigationRequest() ? "NAV" : "-",
            `${elapsed}ms`,
            req.failure()?.errorText ?? "",
            req.url()
        );
    });

    page.on("response", res => {
        const req = res.request();

        if (req.isNavigationRequest() || !res.ok()) {
            debug(
                "[PW][RES]",
                job.title,
                res.status(),
                res.statusText(),
                req.resourceType(),
                req.isNavigationRequest() ? "NAV" : "-",
                res.url()
            );
        }
    });

    page.on("console", msg => {
        debug(
            "[PW][PAGE CONSOLE]",
            job.title,
            msg.type(),
            msg.text()
        );
    });

    page.on("pageerror", error => {
        debug(
            "[PW][PAGE ERROR]",
            job.title,
            error.name,
            error.message
        );
    });

    page.on("close", () => {
        debug(
            "[PW][PAGE CLOSE]",
            job.title,
            getPhase()
        );
    });

    page.on("crash", () => {
        debug(
            "[PW][PAGE CRASH]",
            job.title,
            getPhase()
        );
    });
}

//@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
//@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
//@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
//@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
        sendJson(res, 200, { ok: true });
        return;
    }

    if (req.method !== "POST" || req.url !== "/enqueue") {
        sendJson(res, 404, {
            ok: false,
            error: "not found"
        });
        return;
    }

    let raw = "";

    req.on("data", chunk => {
        raw += chunk;
    });

    req.on("end", async () => {
        try {
            const body = JSON.parse(raw || "{}");
            const url = body.url;

            if (!url || !url.startsWith("https://hitomi.la/")) {
                sendJson(res, 400, {
                    ok: false,
                    error: "invalid url"
                });
                return;
            }

            const job = await enqueue(url);

            sendJson(res, 200, {
                ok: true,
                jobId: job.id
            });
        } catch (error) {
            sendJson(res, 500, {
                ok: false,
                error: String(error?.message ?? error)
            });
        }
    });
});

//---------------------------------------------- - ----------------------------------------------
function sendJson(res, statusCode, body) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
    });

    res.end(JSON.stringify(body));
}

/////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////
server.listen(PORT, "127.0.0.1", () => {
    console.log(`[PW] Hitomi Server Version: ${hitomi_server_ver}`);
    console.log(`[PW] server listening http://127.0.0.1:${PORT}`);
    console.log("");
});

//---------------------------------------------- - ----------------------------------------------
server.on("error", error => {
    if (error.code === "EADDRINUSE") {
        console.log("");
        console.log("Hitomi Downloader は既に起動しています。");
        setTimeout(() => process.exit(0), 1500);
    }

    console.error(error);
    process.exit(1);
});