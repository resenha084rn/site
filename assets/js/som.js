/* Som de fundo com player: tenta iniciar sozinho (volume 50%), liga/desliga e controla o volume.
 * Os navegadores bloqueiam som automático antes de qualquer toque na página. Se bloquear,
 * o som começa no PRIMEIRO toque/clique/tecla do visitante. Quem desligou fica desligado. */
(function () {
  const src = new URL('../audio/fundo.m4a', document.currentScript.src).href;
  const K_OFF = 'r84_som_off', K_VOL = 'r84_som_vol', K_T = 'r84_som_t';
  const safe = (f, d) => { try { return f(); } catch (e) { return d; } };

  const audio = new Audio(src);
  audio.loop = true; audio.preload = 'auto';
  audio.volume = Math.min(1, Math.max(0, Number(safe(() => localStorage.getItem(K_VOL), null) ?? .5)));

  const box = document.createElement('div');
  box.className = 'som';
  box.innerHTML = `<button type="button" class="som-btn" aria-label="Ligar ou desligar o som"></button>
    <input type="range" class="som-vol" min="0" max="100" step="1" aria-label="Volume">`;
  document.body.appendChild(box);
  const btn = box.querySelector('.som-btn'), vol = box.querySelector('.som-vol');
  vol.value = Math.round(audio.volume * 100);

  function ui() {
    const on = !audio.paused;
    box.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on);
    btn.innerHTML = on ? '<span class="eqm"><i></i><i></i><i></i><i></i></span>' : '<span>🔇</span>';
    btn.title = on ? 'Desligar o som' : 'Ligar o som';
  }
  vol.style.setProperty('--p', vol.value + '%');

  async function tocar() {
    const t = Number(safe(() => sessionStorage.getItem(K_T), 0)) || 0;
    if (t && !audio.currentTime) audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = t % (audio.duration || 1e9); } catch (e) { } }, { once: true });
    try { await audio.play(); ui(); return true; } catch (e) { ui(); return false; }
  }

  btn.onclick = async () => {
    if (audio.paused) { safe(() => localStorage.removeItem(K_OFF)); await tocar(); }
    else { audio.pause(); safe(() => localStorage.setItem(K_OFF, '1')); ui(); }
  };
  vol.oninput = () => {
    audio.volume = vol.value / 100; vol.style.setProperty('--p', vol.value + '%');
    safe(() => localStorage.setItem(K_VOL, audio.volume));
    if (audio.paused && vol.value > 0) { safe(() => localStorage.removeItem(K_OFF)); tocar(); }
  };
  audio.addEventListener('play', ui); audio.addEventListener('pause', ui);
  addEventListener('pagehide', () => safe(() => sessionStorage.setItem(K_T, audio.currentTime)));
  ui();

  /* início automático */
  if (safe(() => localStorage.getItem(K_OFF), null) !== '1') {
    tocar().then(ok => {
      if (ok) return;
      const ev = ['pointerdown', 'touchend', 'keydown'];
      const go = () => { ev.forEach(e => removeEventListener(e, go, true)); if (!safe(() => localStorage.getItem(K_OFF), null)) tocar(); };
      ev.forEach(e => addEventListener(e, go, true));
    });
  }
})();
