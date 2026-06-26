console.log("content.js loaded - Test Hitomi Project");

let isF13Down = false;
let capturedLink = null;

//---------------------------------------------- - ----------------------------------------------
window.addEventListener("keydown", e => {
    if (e.key === "F13") {
        isF13Down = true;
        console.log("[HitomiPW] F13 down");
    }
}, true);

//---------------------------------------------- - ----------------------------------------------
window.addEventListener("keyup", e => {
    if (e.key === "F13") {
        isF13Down = false;
        console.log("[HitomiPW] F13 up");
    }
}, true);

//---------------------------------------------- - ----------------------------------------------
document.addEventListener("mousedown", e => {
    if (!isF13Down) return;
    if (e.button !== 0) return;

    const link = e.target.closest("a");
    if (!link?.href) return;

    capturedLink = link.href;

    console.log("[HitomiPW] captured =", capturedLink);

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
}, true);

//---------------------------------------------- - ----------------------------------------------
document.addEventListener("mouseup", async e => {
    if (!isF13Down) {
        capturedLink = null;
        return;
    }

    if (!capturedLink) return;
    if (e.button !== 0) {
        capturedLink = null;
        return;
    }

    const pageUrl = capturedLink;
    capturedLink = null;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    console.log("[HitomiPW] enqueue =", pageUrl);

    try {
        const res = await fetch("http://127.0.0.1:18765/enqueue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: pageUrl })
        });

        console.log("[HitomiPW] response =", await res.json());
    } catch (error) {
        console.error("[HitomiPW] enqueue failed =", error);
    }
}, true);

//---------------------------------------------- - ----------------------------------------------
document.addEventListener("click", e => {
    if (!capturedLink && !isF13Down) return;

    console.log("[HitomiPW] click blocked");

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
}, true);