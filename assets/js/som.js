/* Som de fundo com player (volume padrão 15%, ajustável). A música vem do admin (Firestore);
 * sem música cadastrada, usa assets/audio/fundo.m4a. Pode ser desligada no admin.
 * Regra dos navegadores: som COM áudio só começa depois de um toque na página. Então: tenta tocar
 * com som; se bloquear, inicia MUDO e liga o som no primeiro toque/clique/tecla. Quem desligou fica desligado. */
(function () {
  const PADRAO_SRC = new URL('../audio/fundo.m4a', document.currentScript.src).href;
  const K_OFF = 'r84_som_off', K_VOL = 'r84_som_vol15', K_T = 'r84_som_t';
  const PADRAO = 0.15;
  const safe = (f, d) => { try { return f(); } catch (e) { return d; } };

  const audio = new Audio();
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

  /* descobre qual música tocar (junta os pedaços do Firestore; guarda no cache do navegador) */
  async function srcFirebase(a) {
    const chave = new Request(location.origin + '/__audio/' + a.id);
    let cache = null;
    try { cache = await caches.open('r84-audio'); const r = await cache.match(chave); if (r) return URL.createObjectURL(await r.blob()); } catch (e) { }
    const partes = await Promise.all(Array.from({ length: a.partes }, (_, i) => R.docFB('audio', a.id + '_' + i)));
    const b64 = partes.map(f => f.d.stringValue).join('');
    const blob = await (await fetch(`data:${a.tipo || 'audio/mpeg'};base64,${b64}`)).blob();
    try { if (cache) { await cache.keys().then(ks => ks.forEach(k => { if (k.url !== chave.url) cache.delete(k); })); await cache.put(chave, new Response(blob)); } } catch (e) { }
    return URL.createObjectURL(blob);
  }
  const pronto = (async () => {
    let site = null;
    try { site = await R.conteudo('site', 'data/site.json'); } catch (e) { }
    const a = site && site.audio;
    if (a && a.off) { box.remove(); return false; }          // música desligada no admin
    let src = PADRAO_SRC;
    if (a && a.id) { try { src = await srcFirebase(a); } catch (e) { console.warn('música do Firebase indisponível, usando a padrão', e); } }
    audio.src = src;
    return true;
  })();

  function ui() {
    const tocando = !audio.paused && !audio.muted;
    box.classList.toggle('on', tocando);
    box.classList.toggle('espera', !audio.paused && audio.muted);
    btn.setAttribute('aria-pressed', tocando);
    btn.innerHTML = tocando ? '<span class="eqm"><i></i><i></i><i></i><i></i></span>' : '<span>🔇</span>';
    btn.title = tocando ? 'Desligar o som' : 'Ligar o som';
  }

  async function tocar(comSom) {
    if (!(await pronto)) return 'bloqueado';
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

  /* início automático: qualquer toque/clique/tecla em QUALQUER lugar tenta ligar o som;
   * só para quando o som entra de verdade (rolar a tela não conta como gesto pro navegador) */
  if (safe(() => localStorage.getItem(K_OFF), null) !== '1') {
    const ev = ['pointerdown', 'pointerup', 'mouseup', 'click', 'touchend', 'keydown'];
    const parar = () => ev.forEach(e => removeEventListener(e, go, true));
    const go = async () => {
      if (safe(() => localStorage.getItem(K_OFF), null) === '1') return parar();
      if (!(await pronto)) return parar();
      audio.muted = false;
      try { await audio.play(); } catch (e) { audio.muted = true; audio.play().catch(() => { }); ui(); return; }
      ui();
      if (!audio.paused && !audio.muted) parar();
    };
    ev.forEach(e => addEventListener(e, go, true));
    tocar(false).then(estado => { if (estado === 'som') parar(); });
  }
})();
