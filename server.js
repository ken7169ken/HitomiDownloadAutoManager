/*
【シーケンスフォロー】
    enqueue
        ↓
    runQueue
        ↓
    runJob
        ↓
    page.goto()
        ↓
    title取得
*/
/////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////
const http = require("http");
let activeCount = 0;
const MAX_CONCURRENT_JOBS = 6;
let browserReadyPromise = null;

const fs = require("fs");
const os = require("os");
const path = require("path");

const { chromium } = require("playwright");

const PORT = 18765;
const DOWNLOAD_DIR = getChromeDownloadDirectory();

const queue = [];
let isRunning = false;
let browser = null;
let context = null;

const readline = require("readline");
let jobLineCount = 0;

/////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////
function printJobLine(job, mark) {
    job.lineIndex = jobLineCount++;

    process.stdout.write(`${mark} ${job.title}\n`);
}

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
async function enqueue(url) {
    const job = {
        id:        crypto.randomUUID(),
        url,
        title:     extractTitleFromUrl(url),
        status:    "queued",
        createdAt: Date.now()
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

//---------------------------------------------- - ----------------------------------------------
async function pumpQueue() {
    await ensureBrowser();

    while (activeCount < MAX_CONCURRENT_JOBS && queue.length > 0) {
        const job = queue.shift();

        activeCount++;

        runJob(job)
            .catch(error => {
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
                    console.log("");
                    console.log("◇ queue empty");
                }
            });
    }
}

/////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////
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
            console.log("[PW] Chrome download dir =", dir);
            return dir;
        }
    } catch (error) {
        console.warn("[PW] Chrome Preferences read failed =", error.message);
    }

    const fallback = path.join(os.homedir(), "Downloads");
    //console.log("[PW] fallback download dir =", fallback);
    return fallback;
}

//---------------------------------------------- - ----------------------------------------------
async function runJob(job) {
    updateJobLine(job, "●");

    const page = await context.newPage();

    try {
        await page.goto(job.url, {
            waitUntil: "domcontentloaded",
            timeout: 60_000
        });

        const title = await page.title();
        //console.log("[PW] page title =", title);

        await page.waitForSelector("#dl-button", {
            timeout: 30_000
        });

        const downloadPromise = page.waitForEvent("download", {
            timeout: 120_000
        });

        await page.click("#dl-button");

        const download = await downloadPromise;

        const savePath = path.join(
            DOWNLOAD_DIR,
            download.suggestedFilename()
        );

        await download.saveAs(savePath);
        updateJobLine(job, "★");
    } finally {
        await page.close().catch(() => {});
    }
}

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

/////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////
server.listen(PORT, "127.0.0.1", () => {
    console.log(`[PW] server listening http://127.0.0.1:${PORT}`);
    console.log("");
});

server.on("error", error => {
    if (error.code === "EADDRINUSE") {
        console.log("");
        console.log("Hitomi Downloader は既に起動しています。");
        setTimeout(() => process.exit(0), 1500);
    }

    console.error(error);
    process.exit(1);
});