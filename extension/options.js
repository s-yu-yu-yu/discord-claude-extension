const input = document.querySelector("#bridge-url");
const status = document.querySelector("#status");
const saveButton = document.querySelector("#save");
const testButton = document.querySelector("#test");

function show(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? "#b91c1c" : "#047857";
}

chrome.storage.local.get({ bridgeUrl: "http://127.0.0.1:3456" }).then(({ bridgeUrl }) => { input.value = bridgeUrl; });
saveButton.addEventListener("click", async () => {
  let value;
  try { value = new URL(input.value.trim()).toString().replace(/\/$/, ""); }
  catch { show("Bridge URL が正しくありません。", true); return; }
  await chrome.storage.local.set({ bridgeUrl: value });
  input.value = value;
  show("保存しました。");
});
testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  show("接続を確認しています…");
  try {
    const value = new URL(input.value.trim()).toString().replace(/\/$/, "");
    const response = await fetch(`${value}/health`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    show("Bridge に接続できます。");
  } catch (error) { show(`接続できません: ${error.message}`, true); }
  finally { testButton.disabled = false; }
});
