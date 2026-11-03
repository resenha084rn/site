/* Resenha084 — painel admin (JS puro, 100% estático)
 * Como salva sem servidor: grava os arquivos data/*.json e uploads/* direto no repositório
 * do GitHub pela API, usando um token pessoal (só de escrita neste repo). O GitHub Pages
 * republica o site sozinho em ~1 minuto.
 * A senha é só a "porta" do painel; quem realmente pode publicar é quem tem o token. */
(async function () {
  const $ = s => document.querySelector(s);
  const E = R.esc;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const u82hex = u => [...u].map(b => b.toString(16).padStart(2, '0')).join('');
  const hex2u8 = h => Uint8Array.from(h.match(/.{2}/g).map(x => parseInt(x, 16)));
  const u82b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
  const b642u8 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
  const LS_TOKEN = 'r84_token';

  let site, auth, senha = null, token = null, tab = 'eventos';
  const st = { eventos: [], links: [], linksSujo: false };
  const shas = {};

  /* ============ utilitários de UI ============ */
  let tt;
  function toast(msg, erro) {
    const t = $('#toast'); t.textContent = msg; t.className = 'on' + (erro ? ' err' : '');
    clearTimeout(tt); tt = setTimeout(() => t.className = '', erro ? 6000 : 3500);
  }
  function ocupado(on, txt) { $('#busy').classList.toggle('on', on); if (txt) $('#busyTxt').textContent = txt; }
  async function comBusy(txt, fn) {
    ocupado(true, txt);
    try { return await fn(); }
    catch (e) { console.error(e); toast(msgErro(e), true); throw e; }
    finally { ocupado(false); }
  }
  function msgErro(e) {
    const m = String(e && e.message || e);
    if (/Bad credentials|401/.test(m)) return 'Token inválido ou expirado. Vá em Ajustes → Trocar token.';
    if (/Resource not accessible|403|Forbidden/.test(m)) return 'O token não tem permissão de escrita neste repositório.';
    if (/Failed to fetch|NetworkError/.test(m)) return 'Sem internet? Não consegui falar com o GitHub.';
    return 'Erro: ' + m;
  }

  /* ============ criptografia (Web Crypto) ============ */
  async function derivar(pass, salt, iter) {
    const k = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, k, 256));
  }
  async function senhaConfere(pass) {
    const h = u82hex(await derivar(pass, hex2u8(auth.salt), auth.iteracoes));
    let d = 0; for (let i = 0; i < h.length; i++) d |= h.charCodeAt(i) ^ auth.hash.charCodeAt(i);
    return d === 0 && h.length === auth.hash.length;
  }
  async function chaveToken(pass) {
    const salt = new Uint8Array([...hex2u8(auth.salt), ...enc.encode('tok')]);
    return crypto.subtle.importKey('raw', await derivar(pass, salt, 100000), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  async function guardarToken(tk, pass) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chaveToken(pass), enc.encode(tk)));
    try { localStorage.setItem(LS_TOKEN, JSON.stringify({ iv: u82b64(iv), ct: u82b64(ct) })); } catch (e) { /* modo privado */ }
  }
  async function lerToken(pass) {
    try {
      const o = JSON.parse(localStorage.getItem(LS_TOKEN) || 'null'); if (!o) return null;
      return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b642u8(o.iv) }, await chaveToken(pass), b642u8(o.ct)));
    } catch (e) { return null; }
  }

  /* ============ GitHub API ============ */
  const apiBase = () => `https://api.github.com/repos/${site.repo.owner}/${site.repo.name}`;
  async function gh(path, metodo = 'GET', corpo) {
    const url = apiBase() + '/contents/' + path.split('/').map(encodeURIComponent).join('/') + (metodo === 'GET' ? `?ref=${site.repo.branch}&t=${Date.now()}` : '');
    const r = await fetch(url, {
      method: metodo,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    if (r.status === 404 && metodo === 'GET') return null;
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e.message || '') + ' ' + r.status); }
    return r.json();
  }
  async function lerJSON(path, padrao) {
    const f = await gh(path);
    if (!f) { shas[path] = null; return padrao; }
    shas[path] = f.sha;
    return JSON.parse(dec.decode(b642u8(f.content.replace(/\n/g, ''))));
  }
  async function gravar(path, b64, msg) {
    for (let i = 0; i < 2; i++) {
      try {
        const r = await gh(path, 'PUT', { message: msg, content: b64, branch: site.repo.branch, sha: shas[path] || undefined });
        shas[path] = r.content.sha; return;
      } catch (e) {
        if (i === 0 && /sha|match|conflict|409|422/i.test(e.message)) { const f = await gh(path); shas[path] = f ? f.sha : undefined; continue; }
        throw e;
      }
    }
  }
  const gravarJSON = (path, obj, msg) => gravar(path, u82b64(enc.encode(JSON.stringify(obj, null, 2) + '\n')), msg);
  async function apagar(path, msg) {
    const f = await gh(path); if (!f) return;
    await gh(path, 'DELETE', { message: msg, sha: f.sha, branch: site.repo.branch });
  }
  async function testarToken(tk) {
    const r = await fetch(apiBase(), { headers: { Authorization: 'Bearer ' + tk, Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error('Token recusado (' + r.status + ')');
    const j = await r.json();
    if (j.permissions && !j.permissions.push) throw new Error('Esse token só lê o repositório — precisa de "Contents: Read and write".');
  }

  /* ============ imagem (comprime no celular antes de subir) ============ */
  async function comprimir(file, max = 1280, q = .82) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(res, 'image/jpeg', q));
  }
  const blobB64 = b => new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result.split(',')[1]); f.readAsDataURL(b); });

  /* ============ telas ============ */
  const app = $('#app');

  function telaLogin(erro) {
    app.innerHTML = `<div class="login"><form class="box" id="fLogin">
      <img src="../assets/img/logo.jpg" alt="">
      <h1 class="display">Painel <span class="verde">Resenha084</span></h1>
      <p class="hint" style="margin:8px 0 18px">Entre pra editar a agenda e os links.</p>
      <label>Senha<input type="password" id="pw" autocomplete="current-password" autofocus required></label>
      <button class="btn btn-verde" style="width:100%">Entrar</button>
      <div class="erro" id="erroLogin">${E(erro || '')}</div></form></div>`;
    $('#fLogin').onsubmit = async ev => {
      ev.preventDefault();
      const p = $('#pw').value;
      ocupado(true, 'Conferindo…');
      let ok = false;
      try { ok = await senhaConfere(p); } finally { ocupado(false); }
      if (!ok) { await new Promise(r => setTimeout(r, 900)); return telaLogin('Senha incorreta.'); }
      senha = p; token = await lerToken(p);
      token ? carregar() : telaToken();
    };
  }

  function telaToken(erro) {
    app.innerHTML = `<div class="login"><form class="box" id="fTok">
      <h1 class="display">Conectar ao <span class="verde">GitHub</span></h1>
      <p class="hint" style="margin:8px 0 0">Uma vez só por aparelho. Isso é o que permite publicar de verdade.</p>
      <ol class="passos">
        <li>Abra <b><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" style="color:var(--verde)">github.com/settings/personal-access-tokens/new</a></b> (logado na conta ${E(site.repo.owner)})</li>
        <li>Em <b>Repository access</b>: <b>Only select repositories</b> → <b>${E(site.repo.name)}</b></li>
        <li>Em <b>Permissions → Contents</b>: <b>Read and write</b></li>
        <li><b>Generate token</b> e cole aqui embaixo</li>
      </ol>
      <label>Token<input type="password" id="tk" placeholder="github_pat_..." autocomplete="off" required></label>
      <button class="btn btn-verde" style="width:100%">Conectar</button>
      <div class="erro">${E(erro || '')}</div></form></div>`;
    $('#fTok').onsubmit = async ev => {
      ev.preventDefault();
      const tk = $('#tk').value.trim();
      ocupado(true, 'Testando token…');
      try { await testarToken(tk); } catch (e) { ocupado(false); return telaToken(msgErro(e)); }
      ocupado(false);
      token = tk; await guardarToken(tk, senha); carregar();
    };
  }

  async function carregar() {
    try {
      await comBusy('Carregando…', async () => {
        const [e, l, s] = await Promise.all([
          lerJSON('data/eventos.json', { eventos: [] }),
          lerJSON('data/links.json', { links: [] }),
          lerJSON('data/site.json', site)
        ]);
        st.eventos = e.eventos || []; st.links = l.links || []; site = s; st.linksSujo = false;
      });
      render();
    } catch (e) {
      if (/401|Bad credentials/.test(String(e.message))) { try { localStorage.removeItem(LS_TOKEN); } catch (x) { } telaToken('Token recusado. Gere outro.'); }
      else telaLogin(msgErro(e));
    }
  }

  function render() {
    const abas = [['eventos', '🎶', 'Agenda'], ['links', '🔗', 'Links'], ['ajustes', '⚙️', 'Ajustes']];
    app.innerHTML = `<div class="ad">
      <div class="topo"><img src="../assets/img/logo.jpg" alt=""><h1 class="display">Painel</h1>
        <a class="btn btn-ghost btn-sm sair" href="../" target="_blank">Ver site ↗</a></div>
      <div id="conteudo"></div></div>
      <nav class="tabs">${abas.map(([k, i, n]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}"><span>${i}</span>${n}</button>`).join('')}</nav>`;
    document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; render(); window.scrollTo(0, 0); });
    ({ eventos: abaEventos, links: abaLinks, ajustes: abaAjustes })[tab]();
  }

  /* ---------- ABA: AGENDA ---------- */
  function abaEventos() {
    const hoje = R.hojeStr();
    const ord = (a, b) => (a.data + (a.horario || '99')).localeCompare(b.data + (b.horario || '99'));
    const prox = st.eventos.filter(e => e.tipo !== 'fixo' && e.data >= hoje).sort(ord);
    const pass = st.eventos.filter(e => e.tipo !== 'fixo' && e.data < hoje).sort(ord).reverse();
    const fix = st.eventos.filter(e => e.tipo === 'fixo');
    const linha = (e, cls) => {
      const quando = e.tipo === 'fixo' ? 'Toda ' + R.DIAS[e.diaSemana] : (() => { const d = R.parseData(e.data); return `${R.DIAS_CURTO[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
      return `<div class="item ${cls || ''} ${e.publicado === false ? 'off' : ''}" data-id="${E(e.id)}">
        <div class="mini" style="${e.flyer ? `background-image:url('${E(R.url(e.flyer))}')` : ''}">${e.flyer ? '' : '🎶'}</div>
        <div class="t"><b>${E(e.titulo)}${e.publicado === false ? '<span class="pill rasc">rascunho</span>' : ''}</b><small>${E(quando)} · ${E(e.local || '')}</small></div>
        <div class="bt"><button class="ib" data-a="edit" title="Editar">✏️</button><button class="ib" data-a="dup" title="Duplicar">📄</button><button class="ib perigo" data-a="del" title="Apagar">🗑️</button></div></div>`;
    };
    $('#conteudo').innerHTML =
      `<div class="sec">Próximos (${prox.length})</div>${prox.map(e => linha(e)).join('') || '<div class="vazio">Nenhum evento futuro. Toque em ＋ pra cadastrar.</div>'}
       <div class="sec">Sambas fixos (${fix.length})</div>${fix.map(e => linha(e)).join('') || '<div class="vazio">Nenhum fixo.</div>'}
       ${pass.length ? `<div class="sec">Já passaram (${pass.length})</div>${pass.map(e => linha(e, 'passado')).join('')}` : ''}
       <button class="btn btn-verde fab" id="novo">＋ Novo evento</button>`;
    $('#novo').onclick = () => formEvento();
    $('#conteudo').onclick = ev => {
      const b = ev.target.closest('[data-a]'); if (!b) return;
      const id = b.closest('.item').dataset.id, e = st.eventos.find(x => x.id === id);
      if (b.dataset.a === 'edit') formEvento(e);
      if (b.dataset.a === 'dup') formEvento({ ...e, id: null, titulo: e.titulo, data: '' }, true);
      if (b.dataset.a === 'del') excluirEvento(e);
    };
  }

  async function excluirEvento(e) {
    if (!confirm(`Apagar "${e.titulo}"? Isso não dá pra desfazer.`)) return;
    try {
      await comBusy('Apagando…', async () => {
        const antes = st.eventos;
        st.eventos = st.eventos.filter(x => x.id !== e.id);
        try { await gravarJSON('data/eventos.json', { eventos: st.eventos }, `admin: remove evento ${e.titulo}`); }
        catch (x) { st.eventos = antes; throw x; }
        if (e.flyer && e.flyer.startsWith('uploads/')) { try { await apagar(e.flyer, 'admin: remove flyer'); } catch (x) { } }
      });
      toast('Apagado ✔ (some do site em ~1 min)'); render();
    } catch (x) { render(); }
  }

  function formEvento(ev, duplicando) {
    const novo = !ev || duplicando;
    const e = ev || { tipo: 'unico', data: R.hojeStr(), publicado: true, gratis: false };
    let blobNovo = null, removeu = false;
    const dlg = $('#dlg');
    const dias = R.DIAS.map((d, i) => `<option value="${i}" ${e.diaSemana == i ? 'selected' : ''}>${d}</option>`).join('');
    dlg.innerHTML = `<form id="fEv">
      <h2 class="display">${novo ? 'Novo evento' : 'Editar evento'}</h2>
      <div class="flyer"><div class="prev" id="prev" style="${e.flyer ? `background-image:url('${E(R.url(e.flyer))}')` : ''}">${e.flyer ? '' : 'sem flyer'}</div>
        <input type="file" id="arq" accept="image/*">
        <div style="display:flex;gap:8px;flex-wrap:wrap"><label for="arq" class="btn btn-ghost btn-sm" style="margin:0;cursor:pointer;display:inline-flex">📷 Escolher flyer</label>
        <button type="button" class="btn btn-ghost btn-sm" id="rmFlyer">Remover</button></div></div>
      <label>Nome do evento<input name="titulo" required value="${E(e.titulo)}" placeholder="Ex.: Ribeira Bohemia"></label>
      <label>Tipo<select name="tipo" id="tipo"><option value="unico" ${e.tipo !== 'fixo' ? 'selected' : ''}>Evento em data certa</option><option value="fixo" ${e.tipo === 'fixo' ? 'selected' : ''}>Samba fixo (toda semana)</option></select></label>
      <div class="row2">
        <label id="lData">Data<input type="date" name="data" value="${E(e.data || '')}"></label>
        <label id="lDia" hidden>Dia da semana<select name="diaSemana">${dias}</select></label>
        <label>Horário<input type="time" name="horario" value="${/^\d\d:\d\d$/.test(e.horario || '') ? E(e.horario) : ''}"></label>
      </div>
      <label>Local<input name="local" required value="${E(e.local)}" placeholder="Ex.: Arena das Donas"></label>
      <label>Endereço / bairro<input name="endereco" value="${E(e.endereco)}" placeholder="Ex.: Ribeira, Natal/RN"></label>
      <label>Quem toca (um por linha)<textarea name="artistas">${E((e.artistas || []).join('\n'))}</textarea></label>
      <label class="chk"><input type="checkbox" name="gratis" ${e.gratis ? 'checked' : ''}> Entrada grátis</label>
      <label id="lPreco">Valor<input name="preco" value="${E(e.preco)}" placeholder="Ex.: R$ 20 · A confirmar"></label>
      <label>Observações (opcional)<textarea name="descricao">${E(e.descricao)}</textarea></label>
      <label>Link do mapa (opcional)<input type="url" name="mapa" value="${E(e.mapa)}" placeholder="Cole o link do Google Maps — senão eu gero pelo nome do local"></label>
      <label>Link de ingressos (opcional)<input type="url" name="ingresso" value="${E(e.ingresso)}"></label>
      <label class="chk"><input type="checkbox" name="publicado" ${e.publicado !== false ? 'checked' : ''}> Publicado (desmarque pra deixar como rascunho)</label>
      <div class="rodape"><button type="button" class="btn btn-ghost" id="cancela">Cancelar</button><button class="btn btn-verde">Publicar</button></div>
    </form>`;
    const f = $('#fEv');
    const sync = () => {
      const fixo = f.tipo.value === 'fixo';
      $('#lData').hidden = fixo; $('#lDia').hidden = !fixo; f.data.required = !fixo;
      $('#lPreco').hidden = f.gratis.checked;
    };
    f.tipo.onchange = sync; f.gratis.onchange = sync; sync();
    $('#cancela').onclick = () => dlg.close();
    $('#rmFlyer').onclick = () => { blobNovo = null; removeu = true; $('#prev').style.backgroundImage = ''; $('#prev').textContent = 'sem flyer'; };
    $('#arq').onchange = async () => {
      const file = $('#arq').files[0]; if (!file) return;
      try { blobNovo = await comprimir(file); removeu = false; $('#prev').textContent = ''; $('#prev').style.backgroundImage = `url('${URL.createObjectURL(blobNovo)}')`; }
      catch (x) { toast('Não consegui ler essa imagem.', true); }
    };
    f.onsubmit = async submit => {
      submit.preventDefault();
      const id = (novo ? null : e.id) || 'e' + Date.now().toString(36);
      const fixo = f.tipo.value === 'fixo';
      const obj = {
        id, titulo: f.titulo.value.trim(), tipo: fixo ? 'fixo' : 'unico',
        data: fixo ? '' : f.data.value, diaSemana: fixo ? Number(f.diaSemana.value) : null,
        horario: f.horario.value || '', local: f.local.value.trim(), endereco: f.endereco.value.trim(),
        artistas: f.artistas.value.split('\n').map(x => x.trim()).filter(Boolean),
        gratis: f.gratis.checked, preco: f.gratis.checked ? '' : f.preco.value.trim(),
        descricao: f.descricao.value.trim(), mapa: f.mapa.value.trim(), ingresso: f.ingresso.value.trim(),
        flyer: removeu ? '' : (e.flyer || ''), publicado: f.publicado.checked
      };
      const flyerAntigo = !novo ? e.flyer : '';
      try {
        await comBusy('Publicando…', async () => {
          if (blobNovo) {
            const p = `uploads/${id}-${Date.now().toString(36)}.jpg`;
            shas[p] = undefined; await gravar(p, await blobB64(blobNovo), `admin: flyer de ${obj.titulo}`);
            obj.flyer = p;
          }
          const antes = st.eventos;
          const i = st.eventos.findIndex(x => x.id === id);
          st.eventos = i >= 0 ? st.eventos.map(x => x.id === id ? obj : x) : [...st.eventos, obj];
          try { await gravarJSON('data/eventos.json', { eventos: st.eventos }, `admin: ${i >= 0 ? 'atualiza' : 'adiciona'} evento ${obj.titulo}`); }
          catch (x) { st.eventos = antes; throw x; }
          if (flyerAntigo && flyerAntigo !== obj.flyer && flyerAntigo.startsWith('uploads/')) { try { await apagar(flyerAntigo, 'admin: remove flyer antigo'); } catch (x) { } }
        });
        dlg.close(); toast('Publicado ✔ Aparece no site em ~1 minuto'); render();
      } catch (x) { /* toast já mostrado */ }
    };
    dlg.showModal();
  }

  /* ---------- ABA: LINKS ---------- */
  function abaLinks() {
    $('#conteudo').innerHTML = `
      <p class="hint">Esses links aparecem em <b>/links</b> (o link da bio do Instagram). Use a ordem que quiser.</p>
      ${st.links.map((l, i) => `<div class="item ${l.ativo === false ? 'off' : ''}" data-i="${i}">
        <div class="ic">${E(l.icone || '🔗')}</div>
        <div class="t"><b>${E(l.titulo)}${l.destaque ? '<span class="pill">destaque</span>' : ''}</b><small>${E(l.url)}</small></div>
        <div class="bt"><button class="ib" data-a="up" ${i === 0 ? 'disabled' : ''}>▲</button><button class="ib" data-a="down" ${i === st.links.length - 1 ? 'disabled' : ''}>▼</button><button class="ib" data-a="edit">✏️</button><button class="ib perigo" data-a="del">🗑️</button></div></div>`).join('') || '<div class="vazio">Nenhum link.</div>'}
      <button class="btn btn-ghost" id="novoLink" style="width:100%;margin-top:6px">＋ Adicionar link</button>
      ${st.linksSujo ? '<button class="btn btn-verde fab" id="salvaLinks">💾 Publicar alterações</button>' : ''}`;
    $('#novoLink').onclick = () => formLink();
    const sv = $('#salvaLinks'); if (sv) sv.onclick = salvarLinks;
    $('#conteudo').onclick = ev => {
      const b = ev.target.closest('[data-a]'); if (!b) return;
      const i = Number(b.closest('.item').dataset.i), a = b.dataset.a;
      if (a === 'up' || a === 'down') { const j = a === 'up' ? i - 1 : i + 1;[st.links[i], st.links[j]] = [st.links[j], st.links[i]]; st.linksSujo = true; abaLinks(); }
      if (a === 'edit') formLink(i);
      if (a === 'del' && confirm(`Remover "${st.links[i].titulo}"?`)) { st.links.splice(i, 1); st.linksSujo = true; abaLinks(); }
    };
  }
  async function salvarLinks() {
    try {
      await comBusy('Publicando links…', () => gravarJSON('data/links.json', { links: st.links }, 'admin: atualiza links'));
      st.linksSujo = false; toast('Links publicados ✔ (~1 min)'); abaLinks();
    } catch (x) { }
  }
  function formLink(i) {
    const l = i != null ? st.links[i] : { icone: '🔗', ativo: true, destaque: false };
    const dlg = $('#dlg');
    dlg.innerHTML = `<form id="fLk"><h2 class="display">${i != null ? 'Editar link' : 'Novo link'}</h2>
      <label>Título<input name="titulo" required value="${E(l.titulo)}" placeholder="Ex.: Assistir ao vivo"></label>
      <label>Endereço (URL)<input name="url" required value="${E(l.url)}" placeholder="https://..."></label>
      <label>Ícone (emoji)<input name="icone" maxlength="4" value="${E(l.icone)}"></label>
      <label class="chk"><input type="checkbox" name="destaque" ${l.destaque ? 'checked' : ''}> Destaque (botão verde)</label>
      <label class="chk"><input type="checkbox" name="ativo" ${l.ativo !== false ? 'checked' : ''}> Visível</label>
      <div class="rodape"><button type="button" class="btn btn-ghost" id="cancela">Cancelar</button><button class="btn btn-verde">Salvar</button></div></form>`;
    $('#cancela').onclick = () => dlg.close();
    $('#fLk').onsubmit = ev => {
      ev.preventDefault(); const f = ev.target;
      let url = f.url.value.trim();
      if (!/^(https?:|\.\.?\/|#|mailto:|tel:)/i.test(url)) url = 'https://' + url;
      const o = { id: l.id || 'l' + Date.now().toString(36), titulo: f.titulo.value.trim(), url, icone: f.icone.value.trim() || '🔗', destaque: f.destaque.checked, ativo: f.ativo.checked };
      if (i != null) st.links[i] = o; else st.links.push(o);
      st.linksSujo = true; dlg.close(); abaLinks();
    };
    dlg.showModal();
  }

  /* ---------- ABA: AJUSTES ---------- */
  function abaAjustes() {
    const av = site.aoVivo || { dia: 3, hora: '20:30' };
    $('#conteudo').innerHTML = `
      <form class="box" id="fSite"><h2 class="display" style="font-size:24px;margin-bottom:14px">Site</h2>
        <label>Frase principal<input name="tagline" value="${E(site.tagline)}"></label>
        <label>Sobre o podcast (um item por linha)<textarea name="sobre">${E((site.sobre || []).join('\n'))}</textarea></label>
        <label>YouTube<input type="url" name="youtube" value="${E(site.youtube)}"></label>
        <label>Instagram<input type="url" name="instagram" value="${E(site.instagram)}"></label>
        <div class="row2"><label>Ao vivo — dia<select name="dia">${R.DIAS.map((d, i) => `<option value="${i}" ${av.dia == i ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label>Horário<input type="time" name="hora" value="${E(av.hora)}"></label></div>
        <button class="btn btn-verde" style="width:100%">Publicar</button></form>
      <form class="box" id="fSenha"><h2 class="display" style="font-size:24px;margin-bottom:14px">Trocar senha do painel</h2>
        <label>Nova senha (mín. 8 caracteres)<input type="password" name="n1" minlength="8" autocomplete="new-password" required></label>
        <label>Repita<input type="password" name="n2" minlength="8" autocomplete="new-password" required></label>
        <button class="btn btn-ghost" style="width:100%">Trocar senha</button></form>
      <div class="box"><h2 class="display" style="font-size:24px;margin-bottom:10px">Conta</h2>
        <p class="hint">Repositório: <b>${E(site.repo.owner)}/${E(site.repo.name)}</b> (${E(site.repo.branch)})</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" id="trocaTk">Trocar token do GitHub</button>
          <button class="btn btn-ghost btn-sm" id="sair">Sair</button></div></div>`;
    $('#fSite').onsubmit = async ev => {
      ev.preventDefault(); const f = ev.target;
      const novo = { ...site, tagline: f.tagline.value.trim(), sobre: f.sobre.value.split('\n').map(x => x.trim()).filter(Boolean), youtube: f.youtube.value.trim(), instagram: f.instagram.value.trim(), aoVivo: { ...(site.aoVivo || {}), dia: Number(f.dia.value), hora: f.hora.value || '20:30', duracaoHoras: (site.aoVivo && site.aoVivo.duracaoHoras) || 2 } };
      try { await comBusy('Publicando…', () => gravarJSON('data/site.json', novo, 'admin: atualiza ajustes do site')); site = novo; toast('Publicado ✔'); } catch (x) { }
    };
    $('#fSenha').onsubmit = async ev => {
      ev.preventDefault(); const f = ev.target;
      if (f.n1.value !== f.n2.value) return toast('As senhas não batem.', true);
      try {
        await comBusy('Trocando senha…', async () => {
          const salt = crypto.getRandomValues(new Uint8Array(16)), it = 200000;
          const novo = { salt: u82hex(salt), iteracoes: it, hash: u82hex(await derivar(f.n1.value, salt, it)) };
          await gravarJSON('data/admin.json', novo, 'admin: troca senha');
          auth = novo; senha = f.n1.value; await guardarToken(token, senha);
        });
        f.reset(); toast('Senha trocada ✔ (vale em ~1 min em outros aparelhos)');
      } catch (x) { }
    };
    $('#trocaTk').onclick = () => { try { localStorage.removeItem(LS_TOKEN); } catch (x) { } token = null; telaToken(); };
    $('#sair').onclick = () => { senha = null; token = null; telaLogin(); };
  }

  /* ============ início ============ */
  try {
    [site, auth] = await Promise.all([R.json('data/site.json'), R.json('data/admin.json')]);
  } catch (e) { app.innerHTML = '<div class="login"><div class="box">Não consegui carregar a configuração do painel.</div></div>'; return; }
  if (!window.crypto || !crypto.subtle) { app.innerHTML = '<div class="login"><div class="box">Este navegador/endereço não tem criptografia disponível. Abra pelo link https do GitHub Pages.</div></div>'; return; }
  telaLogin();
})();
