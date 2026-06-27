console.log("content.js loaded - Test Hitomi Project");

let capturedLink = null;

//---------------------------------------------- - ----------------------------------------------
document.addEventListener("mousedown", e => {
    if (!e.altKey) return;
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
    if (!e.altKey) {
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
    if (!capturedLink && !e.altKey) return;

    console.log("[HitomiPW] click blocked");

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
}, true);