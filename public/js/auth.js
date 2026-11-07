const form = document.getElementById('auth-form');
const msg = document.getElementById('msg');
const mode = form.dataset.mode;

function show(text, kind = 'error') {
  msg.textContent = text;
  msg.className = `msg show ${kind}`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (mode === 'signup' && !document.getElementById('agree').checked) return show('Please accept the honesty pledge to continue.');
  if (!data.email || !data.password) return show('Please fill in your email and password.');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Something went wrong.');
    show(mode === 'signup' ? 'Account created! Opening your workspace…' : 'Logged in. Opening your workspace…', 'ok');
    location.href = '/app';
  } catch (err) {
    show(err.message);
    btn.disabled = false;
  }
});
