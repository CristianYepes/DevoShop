document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('assistant-form');
  const input = document.getElementById('assistant-input');
  const button = document.getElementById('assistant-submit');
  const reply = document.getElementById('assistant-reply');

  if (!form || !input || !button || !reply) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const pregunta = input.value.trim();
    if (!pregunta) return;

    button.disabled = true;
    reply.hidden = false;
    reply.textContent = 'Consultando...';

    try {
      const res = await fetch('/api/asistente', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pregunta }),
      });
      const data = await res.json();
      reply.textContent = res.ok ? (data.respuesta || '') : (data.error || 'No se pudo consultar al asistente.');
    } catch {
      reply.textContent = 'Error de conexión con el asistente.';
    } finally {
      button.disabled = false;
    }
  });
});
