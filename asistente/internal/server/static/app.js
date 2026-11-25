document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('assistant-form');
  const input = document.getElementById('pregunta');
  const btn = document.getElementById('submit-btn');
  const box = document.getElementById('respuesta-box');
  const out = document.getElementById('respuesta-texto');

  if (!form || !input || !btn || !box || !out) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const pregunta = input.value.trim();
    if (!pregunta) return;

    btn.disabled = true;
    box.hidden = false;
    out.textContent = 'Consultando...';

    try {
      const res = await fetch('/api/asistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pregunta }),
      });
      const data = await res.json();
      if (!res.ok) {
        out.textContent = data.error || 'No se pudo procesar la consulta.';
      } else {
        out.textContent = data.respuesta || '';
      }
    } catch {
      out.textContent = 'Error de conexión con el asistente.';
    } finally {
      btn.disabled = false;
    }
  });
});
