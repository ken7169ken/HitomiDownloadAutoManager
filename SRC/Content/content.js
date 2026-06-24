// JavaScript source code
chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== "HITOMI_STUCK") return;

    console.log(
        "%c🚑💥🩸😱 通信血栓でド嵌り進行中！",
        "color:red;font-size:24px;font-weight:bold;"
    );

    console.log(`[HitomiRescue] reason=${message.reason}`);
});