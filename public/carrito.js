// Cart: changing a quantity updates the cart straight away (no "Actualizar" button).
// Served from /static so the CSP can keep forbidding inline scripts. Without JavaScript,
// a <noscript> button still submits the form.
document.addEventListener('change', (e) => {
  const field = e.target;
  if (field instanceof HTMLSelectElement && field.hasAttribute('data-autosubmit') && field.form) {
    field.form.requestSubmit();
  }
});
