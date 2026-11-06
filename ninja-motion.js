// Decorative feedback shared by the test and its visual preview.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
export function runNinjaStart(button, start) {
  if (document.body.dataset.theme !== 'ninja' || reducedMotion.matches) { start(); return; }
  if (button.classList.contains('is-throwing')) return;
  button.classList.add('is-throwing');
  setTimeout(() => {
    button.classList.remove('is-throwing');
    start();
  }, 360);
}

document.addEventListener('click', event => {
  const start = event.target.closest('a[data-start-shuriken]');
  if (!start || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  runNinjaStart(start, () => location.assign(start.href));
});

if (!document.querySelector('.ninja-petals')) {
  const layer = document.createElement('div');
  layer.className = 'ninja-petals';
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);
}

let lastPetals = -Infinity;
addEventListener('scroll', () => {
  if (document.body.dataset.theme !== 'ninja' || document.querySelector('#app, #design')?.dataset.page !== 'home' || reducedMotion.matches || document.hidden) return;
  const now = performance.now();
  const layer = document.querySelector('.ninja-petals');
  if (now - lastPetals < 1800 || !layer || layer.childElementCount) return;
  lastPetals = now;
  for (let index = 0; index < 6; index++) {
    const petal = document.createElement('i');
    petal.className = 'ninja-petal';
    petal.style.setProperty('--petal-x', `${8 + index * 17}%`);
    petal.style.setProperty('--petal-duration', `${2.5 + index * .14}s`);
    petal.style.setProperty('--petal-drift', `${index % 2 ? 42 : -25}px`);
    petal.addEventListener('animationend', () => petal.remove(), { once: true });
    layer.append(petal);
  }
}, { passive: true });
