(async () => {
  const id = new URLSearchParams(location.search).get("id");
  const loading = document.getElementById("loading");
  if (!id) {
    loading.textContent = "Missing print id";
    return;
  }
  const key = `print:${id}`;
  const data = await chrome.storage.session.get(key);
  const html = data[key] && data[key].html;
  if (!html) {
    loading.textContent = "Print content expired — export again";
    return;
  }
  document.open();
  document.write(html);
  document.close();
  setTimeout(() => {
    try {
      window.print();
    } catch {
      // user can click the on-page button
    }
  }, 350);
})();
