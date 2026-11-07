document.querySelectorAll('#yr').forEach((el) => { el.textContent = new Date().getFullYear(); });

// Show "Support" buttons only when the owner has set DONATE_URL on the server.
fetch('/api/config').then((r) => r.json()).then((c) => {
  if (!c.donateUrl) return;
  document.querySelectorAll('[data-donate]').forEach((el) => {
    el.href = c.donateUrl;
    el.hidden = false;
  });
}).catch(() => {});
