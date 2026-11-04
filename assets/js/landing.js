(async function () {
  const $ = s => document.querySelector(s);
  const E = R.esc;
  let site, eventos = [], filtro = 'prox';

  try {
    [site, { eventos }] = await Promise.all([R.conteudo('site', 'data/site.json'), R.conteudo('eventos', 'data/eventos.json')]);
  } catch (e) {
    $('#grade').innerHTML = '<div class="vazio">Não consegui carregar a agenda agora. Tente de novo em instantes.</div>';
    console.error(e); return;
  }

  /* ---------- textos do site ---------- */
  if (site.youtube) { $('#btnYt').href = site.youtube; $('#fYt').href = site.youtube; }
  if (site.instagram) $('#fIg').href = site.instagram;
  $('#goAdmin').addEventListener('click', () => { location.href = 'admin/'; });   // atalho discreto: só o "084" abre o admin
  { const ini = 2026, atual = R.agoraBR().getUTCFullYear(); $('#ano').textContent = atual > ini ? `${ini}–${atual}` : String(ini); }
  $('#sobreLista').innerHTML = (site.sobre || []).map((t, i) => `<li><span>${['🎙️', '🎤', '📍', '🔴'][i % 4]}</span><span>${E(t)}</span></li>`).join('');

  /* ---------- equalizador ---------- */
  $('.eq').innerHTML = '<i></i>'.repeat(26);
  document.querySelectorAll('.eq i').forEach((el, i) => el.style.animationDelay = (-(i * 137 % 1000)) + 'ms');

  /* ---------- contagem do ao vivo ---------- */
  const av = site.aoVivo || { dia: 3, hora: '20:30', duracaoHoras: 2 };
  const [ah, am] = av.hora.split(':').map(Number);
  $('#liveTxt').textContent = `Toda ${R.DIAS[av.dia]}, às ${R.hora(av.hora)}`;
  function tickLive() {
    const agora = Date.now() - 3 * 3600e3;               // "relógio de Natal" em UTC
    const n = new Date(agora);
    let ini = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + ((av.dia - n.getUTCDay() + 7) % 7), ah, am);
    const dur = (av.duracaoHoras || 2) * 3600e3;
    if (ini + dur < agora) ini += 7 * 864e5;
    const on = agora >= ini && agora <= ini + dur;
    $('#live').classList.toggle('on', on);
    $('#liveTag').textContent = on ? 'Ao vivo agora' : 'Próximo ao vivo';
    if (on) {
      $('#cont').innerHTML = `<a class="btn btn-verde btn-sm" href="${E(site.youtube)}" target="_blank" rel="noopener">▶ Assistir agora</a>`;
      return;
    }
    let s = Math.floor((ini - agora) / 1000);
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60); s %= 60;
    const caixa = (v, l) => `<div><b>${String(v).padStart(2, '0')}</b><span>${l}</span></div>`;
    $('#cont').innerHTML = caixa(d, 'dias') + caixa(h, 'horas') + caixa(m, 'min') + caixa(s, 'seg');
  }
  tickLive(); setInterval(tickLive, 1000);

  /* ---------- próximo episódio ---------- */
  const hoje = R.hojeStr();
  const ep = site.episodio;
  if (ep && ep.data && ep.data >= hoje && (ep.convidado || ep.banner)) {
    const d = R.parseData(ep.data), ehHoje = ep.data === hoje;
    $('#ep').className = 'ep';
    $('#ep').innerHTML = `${ep.banner ? R.imgTag(ep.banner, 'Banner do episódio com ' + ep.convidado) : ''}
      <div><div class="k">${ehHoje ? 'É hoje!' : 'Próximo episódio'}</div>
        <h3>${E(ep.convidado || 'Novo episódio')}</h3>
        <p>📅 <b>${R.DIAS_CURTO[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}</b> às <b>${E(R.hora(ep.hora || av.hora))}</b></p>
        ${ep.apresentador ? `<p>🎙️ Apresentação: <b>${E(ep.apresentador)}</b></p>` : ''}
        ${site.transmissao ? `<p>📺 Transmissão: <b>${E(site.transmissao)}</b></p>` : ''}
        <a class="btn btn-verde btn-sm" href="${E(site.youtube)}" target="_blank" rel="noopener">▶ Assistir no YouTube</a></div>`;
    R.hidratar($('#ep'));
  }

  /* ---------- agenda ---------- */
  const publicados = eventos.filter(e => e.publicado !== false);
  const unicos = publicados.filter(e => e.tipo !== 'fixo' && e.data && e.data >= hoje)
    .sort((a, b) => (a.data + (a.horario || '99')).localeCompare(b.data + (b.horario || '99')));
  const fixos = publicados.filter(e => e.tipo === 'fixo');

  function filtrar() {
    if (filtro === 'hoje') return unicos.filter(e => e.data === hoje);
    if (filtro === 'fds') return unicos.filter(e => { const d = R.diaSemanaDe(e.data); return d === 0 || d === 5 || d === 6; });
    if (filtro === 'gratis') return unicos.filter(e => e.gratis);
    return unicos;
  }
  function flyerHTML(e) {
    return e.flyer
      ? R.imgTag(e.flyer, 'Flyer: ' + e.titulo)
      : `<div class="ph"><img src="assets/img/logo.jpg" alt=""></div>`;
  }
  function render() {
    const lista = filtrar();
    $('#grade').innerHTML = lista.length ? lista.map(e => {
      const d = R.parseData(e.data), ehHoje = e.data === hoje;
      return `<button class="ev rev" data-id="${E(e.id)}" data-data="${e.data}">
        <div class="fl">${flyerHTML(e)}
          <div class="badge-data"><b>${d.getUTCDate()}</b><span>${R.MESES[d.getUTCMonth()]} · ${R.DIAS_CURTO[d.getUTCDay()]}</span></div>
          ${ehHoje ? '<div class="badge-hoje">HOJE</div>' : ''}
        </div>
        <div class="tx"><h3>${E(e.titulo)}</h3>
          <div class="meta">📍 ${E(e.local)}</div>
          <div class="meta">🕗 ${E(R.hora(e.horario) || 'Horário a confirmar')}</div>
          <span class="preco ${e.gratis ? 'free' : ''}">${E(R.preco(e))}</span>
        </div></button>`;
    }).join('') : `<div class="vazio">${filtro === 'prox' ? 'Nenhum evento cadastrado por enquanto. Volta já! 🎶' : 'Nada por aqui nesse filtro. Tente outro. 😉'}</div>`;
    observar(); R.hidratar($('#grade'));
  }
  $('#chips').addEventListener('click', ev => {
    const b = ev.target.closest('.chip'); if (!b) return;
    filtro = b.dataset.f;
    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
    render();
  });

  /* ---------- fixos ---------- */
  const hojeDia = R.agoraBR().getUTCDay();
  $('#fixosLista').innerHTML = fixos.length
    ? [...fixos].sort((a, b) => ((a.diaSemana - hojeDia + 7) % 7) - ((b.diaSemana - hojeDia + 7) % 7)).map(e => `
      <button class="fx rev ${e.diaSemana === hojeDia ? 'hoje' : ''}" data-id="${E(e.id)}" data-data="${R.proximaFixo(e)}">
        <div class="dia">${R.DIAS_CURTO[e.diaSemana]}</div>
        <div><h3>${E(e.titulo)}</h3><p>${E(e.local)} · ${E(R.hora(e.horario) || 'horário a confirmar')} · ${E(R.preco(e))}</p></div>
      </button>`).join('')
    : '<div class="vazio">Sem sambas fixos cadastrados ainda.</div>';

  /* ---------- modal ---------- */
  const modal = $('#modal');
  function abrir(id, data) {
    const e = eventos.find(x => x.id === id); if (!e) return;
    const quando = e.tipo === 'fixo'
      ? `Toda ${R.DIAS[e.diaSemana]}`
      : (() => { const d = R.parseData(data); return `${R.DIAS[d.getUTCDay()]}, ${d.getUTCDate()} de ${['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][d.getUTCMonth()]}`; })();
    const linha = (ic, rot, val) => val ? `<div class="linha"><span>${ic}</span><div><small>${rot}</small>${val}</div></div>` : '';
    const txtZap = `${e.titulo} — ${quando}${e.horario ? ' às ' + R.hora(e.horario) : ''} · ${e.local}\nAgenda do samba: ${location.origin}${location.pathname}#agenda`;
    modal.innerHTML = `<button class="fechar" aria-label="Fechar">✕</button>
      <div class="md">
        <div class="fl">${e.flyer ? R.imgTag(e.flyer, 'Flyer: ' + e.titulo) : `<div class="ph"><img src="assets/img/logo.jpg" alt=""></div>`}</div>
        <div class="info">
          <h2 class="display">${E(e.titulo)}</h2>
          ${linha('📅', 'Quando', E(quando) + (e.horario ? ' · ' + E(R.hora(e.horario)) : ''))}
          ${linha('📍', 'Onde', `<b>${E(e.local)}</b>${e.endereco ? '<br>' + E(e.endereco) : ''}`)}
          ${linha('🎤', 'Quem toca', (e.artistas || []).length ? (e.artistas || []).map(E).join(' · ') : '')}
          ${linha('💸', 'Entrada', `<b>${E(R.preco(e))}</b>`)}
          ${e.descricao ? `<p style="color:var(--muted)">${E(e.descricao)}</p>` : ''}
          <div class="acoes">
            <a class="btn btn-verde btn-sm" href="${E(R.mapaUrl(e))}" target="_blank" rel="noopener">🗺️ Como chegar</a>
            <a class="btn btn-ghost btn-sm" href="https://wa.me/?text=${encodeURIComponent(txtZap)}" target="_blank" rel="noopener">💬 Compartilhar</a>
            <button class="btn btn-ghost btn-sm" id="btnCal">📆 Lembrar</button>
            ${e.ingresso ? `<a class="btn btn-ghost btn-sm" href="${E(e.ingresso)}" target="_blank" rel="noopener">🎟️ Ingressos</a>` : ''}
          </div>
        </div>
      </div>`;
    R.hidratar(modal);
    modal.querySelector('.fechar').onclick = () => modal.close();
    modal.querySelector('#btnCal').onclick = () => R.baixar((e.titulo || 'evento').replace(/\W+/g, '-') + '.ics', R.ics(e, data), 'text/calendar');
    modal.showModal();
  }
  document.addEventListener('click', ev => {
    const c = ev.target.closest('.ev, .fx'); if (c) abrir(c.dataset.id, c.dataset.data);
    if (ev.target === modal) modal.close();
  });

  /* ---------- animação ao rolar ---------- */
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { threshold: .08 }) : null;
  function observar() { document.querySelectorAll('.rev:not(.in)').forEach(el => io ? io.observe(el) : el.classList.add('in')); }

  render(); observar();
  if (location.hash && document.querySelector(location.hash)) document.querySelector(location.hash).scrollIntoView();
})();
