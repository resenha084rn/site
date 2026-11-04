/* Som de fundo com player (volume padrão 15%, ajustável).
 * Regra dos navegadores: som COM áudio só começa depois de um toque na página.
 * Então: tenta tocar com som; se bloquear, inicia MUDO na hora (isso é permitido) e
 * liga o som sozinho no primeiro toque/clique/tecla do visitante. Quem desligou fica desligado. */
(function () {
  const src = new URL('../audio/fundo.m4a', document.currentScript.src).href;
  const K_OFF = 'r84_som_off', K_VOL = 'r84_som_vol15', K_T = 'r84_som_t';
  const PADRAO = 0.15;
  const safe = (f, d) => { try { return f(); } catch (e) { return d; } };

  const audio = new Audio(src);
  audio.loop = true; audio.preload = 'auto';
  const salvo = safe(() => localStorage.getItem(K_VOL), null);
  audio.volume = salvo === null ? PADRAO : Math.min(1, Math.max(0, Number(salvo)));

  const box = document.createElement('div');
  box.className = 'som';
  box.innerHTML = `<button type="button" class="som-btn" aria-label="Ligar ou desligar o som"></button>
    <input type="range" class="som-vol" min="0" max="100" step="1" aria-label="Volume">`;
  document.body.appendChild(box);
  const btn = box.querySelector('.som-btn'), vol = box.querySelector('.som-vol');
  vol.value = Math.round(audio.volume * 100);
  vol.style.setProperty('--p', vol.value + '%');

  function ui() {
    const tocando = !audio.paused && !audio.muted;
    box.classList.toggle('on', tocando);
    box.classList.toggle('espera', !audio.paused && audio.muted);
    btn.setAttribute('aria-pressed', tocando);
    btn.innerHTML = tocando ? '<span class="eqm"><i></i><i></i><i></i><i></i></span>' : '<span>🔇</span>';
    btn.title = tocando ? 'Desligar o som' : 'Ligar o som';
  }

  async function tocar(comSom) {
    const t = Number(safe(() => sessionStorage.getItem(K_T), 0)) || 0;
    if (t && !audio.currentTime) audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = t % (audio.duration || 1e9); } catch (e) { } }, { once: true });
    audio.muted = false;
    try { await audio.play(); ui(); return 'som'; } catch (e) { }
    if (comSom) { ui(); return 'bloqueado'; }
    audio.muted = true;                      // autoplay mudo é sempre permitido
    try { await audio.play(); ui(); return 'mudo'; } catch (e) { ui(); return 'bloqueado'; }
  }

  btn.onclick = async () => {
    if (!audio.paused && !audio.muted) { audio.pause(); safe(() => localStorage.setItem(K_OFF, '1')); }
    else { safe(() => localStorage.removeItem(K_OFF)); audio.muted = false; if (audio.paused) await tocar(true); }
    ui();
  };
  vol.oninput = () => {
    audio.volume = vol.value / 100; vol.style.setProperty('--p', vol.value + '%');
    safe(() => localStorage.setItem(K_VOL, audio.volume));
    if (audio.muted && vol.value > 0) { audio.muted = false; safe(() => localStorage.removeItem(K_OFF)); if (audio.paused) tocar(true); ui(); }
  };
  audio.addEventListener('play', ui); audio.addEventListener('pause', ui); audio.addEventListener('volumechange', ui);
  addEventListener('pagehide', () => safe(() => sessionStorage.setItem(K_T, audio.currentTime)));
  ui();

  /* início automático */
  if (safe(() => localStorage.getItem(K_OFF), null) !== '1') {
    tocar(false).then(estado => {
      if (estado === 'som') return;
      const ev = ['pointerdown', 'touchend', 'keydown'];
      const go = () => {
        ev.forEach(e => removeEventListener(e, go, true));
        if (safe(() => localStorage.getItem(K_OFF), null) === '1') return;
        audio.muted = false;
        if (audio.paused) tocar(true); else ui();
      };
      ev.forEach(e => addEventListener(e, go, true));
    });
  }
})();
