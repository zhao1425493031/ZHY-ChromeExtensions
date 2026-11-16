const btnStart = document.getElementById("btn-start");
const btnClear = document.getElementById("btn-clear");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("history-list");
const emptyEl = document.getElementById("history-empty");

const t = (key) => chrome.i18n.getMessage(key) || key;

document.querySelectorAll("[data-i18n]").forEach((el) => {
  const key = el.getAttribute("data-i18n");
  const msg = t(key);
  if (msg) el.textContent = msg;
});

btnStart.addEventListener("click", async () => {
  setStatus("");
  btnStart.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "PA_START_FROM_POPUP" });
    if (!res?.ok) throw new Error(res?.error || t("startFailed"));
    window.close();
  } catch (err) {
    setStatus(err?.message || t("startFailed"));
    btnStart.disabled = false;
  }
});

btnClear.addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "PA_CLEAR_HISTORY" });
  if (res?.ok) renderHistory(res.items || []);
});

init();

async function init() {
  const res = await chrome.runtime.sendMessage({ type: "PA_GET_HISTORY" });
  renderHistory(res?.ok ? res.items || [] : []);
}

function renderHistory(items) {
  listEl.innerHTML = "";
  const has = items.length > 0;
  emptyEl.hidden = has;
  if (!has) return;

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "card";

    let thumb;
    if (item.dataUrl) {
      thumb = document.createElement("img");
      thumb.alt = t("thumbAlt");
      thumb.src = item.dataUrl;
    } else {
      thumb = document.createElement("div");
      thumb.className = "thumb-fallback";
      thumb.textContent = t("noImage");
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    const title = item.title || item.url || t("untitled");
    const note = item.note ? `<div class="note" title="${escapeAttr(item.note)}">${escapeHtml(item.note)}</div>` : "";
    meta.innerHTML = `
      <div class="title" title="${escapeAttr(title)}">${escapeHtml(title)}</div>
      ${note}
      <div class="time">${formatTime(item.createdAt)}</div>
    `;

    const actions = document.createElement("div");
    actions.className = "actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = t("btnCopy");
    copyBtn.disabled = !item.dataUrl;
    copyBtn.addEventListener("click", async () => {
      try {
        await copyImage(item.dataUrl);
        setStatus(t("copied"), false);
      } catch {
        setStatus(t("copyFailed"));
      }
    });

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = t("btnOpen");
    openBtn.disabled = !item.dataUrl;
    openBtn.addEventListener("click", () => {
      if (item.dataUrl) chrome.tabs.create({ url: item.dataUrl });
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "danger";
    delBtn.textContent = t("btnDelete");
    delBtn.addEventListener("click", async () => {
      const res = await chrome.runtime.sendMessage({
        type: "PA_DELETE_HISTORY",
        id: item.id
      });
      if (res?.ok) renderHistory(res.items || []);
    });

    actions.append(copyBtn, openBtn, delBtn);
    card.append(thumb, meta, actions);
    listEl.appendChild(card);
  }
}

async function copyImage(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type || "image/png"]: blob })
  ]);
}

function setStatus(text, isError = true) {
  if (!text) {
    statusEl.hidden = true;
    statusEl.textContent = "";
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.style.background = isError ? "#fff1f2" : "#ecfeff";
  statusEl.style.color = isError ? "#9f1239" : "#155e75";
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", "&#39;");
}
