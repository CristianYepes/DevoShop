// Cart: changing a quantity updates the cart by itself (no "Actualizar" button).
// - Arrows (spinner) or leaving the field / pressing Enter: submits straight away ("change").
// - Typing: submits after a short pause, so "12" is not sent as "1" then "12" ("input").
// Served from /static so the CSP can keep forbidding inline scripts. Without JavaScript,
// a <noscript> button still submits the form.
const PAUSE_MS = 700;
let timer;

function submitIfValid(field) {
  clearTimeout(timer);
  const n = Number(field.value);
  if (field.value === '' || !Number.isInteger(n) || n < 0 || n > 20) return;
  if (String(n) === field.defaultValue) return; // nothing changed
  field.form.requestSubmit();
}

const isQty = (el) => el instanceof HTMLInputElement && el.hasAttribute('data-autosubmit') && el.form;

document.addEventListener('input', (e) => {
  if (!isQty(e.target)) return;
  clearTimeout(timer);
  timer = setTimeout(() => submitIfValid(e.target), PAUSE_MS);
});

document.addEventListener('change', (e) => {
  if (isQty(e.target)) submitIfValid(e.target);
});
