// HTML templates. No inline scripts or style attributes, so the CSP can forbid 'unsafe-inline'.

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function layout({ title, description, body }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="stylesheet" href="/static/styles.css">
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
</head>
<body>
<header class="site-header"><a class="brand" href="/">DevoShop</a></header>
<main>
${body}
</main>
<footer class="site-footer"><p>DevoShop · Compra como invitado · Pago simulado</p></footer>
</body>
</html>`;
}

export function renderHome() {
  return layout({
    title: 'DevoShop | Muebles y hogar con envío rápido',
    description: 'Tienda online de muebles y decoración. Compra como invitado, sin registro, en pocos pasos.',
    body: `<h1>Muebles y hogar para cada espacio</h1>
<p>Compra como invitado, sin registro. Precios con IVA incluido.</p>
<section class="assistant-panel" aria-labelledby="assistant-heading">
  <h2 id="assistant-heading">Asistente de la tienda</h2>
  <p>Pregunta sobre productos, precios, envíos, montaje, devoluciones, garantía o pago.</p>
  <form id="assistant-form" class="assistant-form" action="/api/asistente" method="post">
    <label for="assistant-input">Tu consulta</label>
    <div class="assistant-row">
      <input id="assistant-input" name="pregunta" type="text" required maxlength="500" placeholder="Ej.: ¿Cuánto cuesta el envío?">
      <button id="assistant-submit" type="submit">Preguntar</button>
    </div>
  </form>
  <div id="assistant-reply" class="assistant-reply" aria-live="polite" hidden></div>
</section>
<script src="/static/asistente.js" defer></script>`,
  });
}

const ERROR_TEXT = {
  400: 'Petición no válida',
  404: 'Página no encontrada',
  405: 'Método no permitido',
  413: 'Petición demasiado grande',
  500: 'Error interno',
};

export function renderError(status) {
  const text = ERROR_TEXT[status] ?? 'Error';
  return layout({
    title: `${text} | DevoShop tienda online`,
    description: 'La página que buscas no está disponible. Vuelve a la portada de DevoShop.',
    body: `<h1>${text}</h1><p><a href="/">Volver a la portada</a></p>`,
  });
}
