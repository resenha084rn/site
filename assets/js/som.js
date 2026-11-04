/* Botão "Ouvir" — som de fundo OPCIONAL (começa desligado; só toca após o clique). */
(function () {
  const src = new URL('../audio/fundo.m4a', document.currentScript.src).href;
  const K_ON = 'r84_som', K_T = 'r84_som_t';
  const safe = (f, d) => { try { return f(); } catch (e) { return d; } };

  const audio = new Audio(src);
  audio.loop = true; audio.preload = 'none'; audio.volume = .45;

  const btn = document.createElement('button');
  btn.className = 'som'; btn.type = 'button';
  document.body.appendChild(btn);

  function ui(on) {
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on);
    btn.innerHTML = on
      ? '<span class="eqm"><i></i><i></i><i></i><i></i></span><b>Som ligado</b>'
      : '<span>🔊</span><b>Ouvir</b>';
    btn.title = on ? 'Desligar o som' : 'Ligar o som de fundo';
  }
  async function tocar() {
    const t = Number(safe(() => sessionStorage.getItem(K_T), 0)) || 0;
    if (t) audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = t % (audio.duration || 1e9); } catch (e) { } }, { once: true });
    try { await audio.play(); ui(true); safe(() => localStorage.setItem(K_ON, '1')); return true; }
    catch (e) { ui(false); return false; }   // navegador bloqueou: continua desligado
  }
  function parar() { audio.pause(); ui(false); safe(() => localStorage.setItem(K_ON, '0')); }

  btn.onclick = () => audio.paused ? tocar() : parar();
  addEventListener('pagehide', () => safe(() => sessionStorage.setItem(K_T, audio.currentTime)));
  ui(false);
  /* quem já ligou antes: tenta retomar; se o navegador não deixar, fica desligado */
  if (safe(() => localStorage.getItem(K_ON), '0') === '1') tocar();
})();
