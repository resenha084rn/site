/* Resenha084 — painel admin (JS puro + Firebase)
 * Login: Google. Permissão: documento papeis/<email> no Firestore ("editor" ou "postador").
 * Quem realmente protege os dados são as regras do Firestore (firestore.rules), que rodam nos
 * servidores do Google — o painel só esconde o que a pessoa não pode usar.
 * Conteúdo: conteudo/{site,eventos,links} guardam um campo "json". Flyers: flyers/{id}.data (base64). */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const $ = s => document.querySelector(s);
const E = R.esc;
const app = $('#app');

let db, auth, user = null, papel = null, tab = 'eventos', site = {};
const st = { eventos: [], links: [], linksSujo: false };

/* ============ UI ============ */
let tt;
function toast(msg, erro) { const t = $('#toast'); t.textContent = msg; t.className = 'on' + (erro ? ' err' : ''); clearTimeout(tt); tt = setTimeout(() => t.className = '', erro ? 6000 : 3500); }
function ocupado(on, txt) { $('#busy').classList.toggle('on', on); if (txt) $('#busyTxt').textContent = txt; }
function msgErro(e) {
  const m = String((e && (e.code || e.message)) || e);
  if (/permission-denied|insufficient/i.test(m)) return 'Sem permissão para essa ação com o seu e-mail.';
  if (/network|unavailable|Failed to fetch/i.test(m)) return 'Sem internet? Não consegui falar com o Firebase.';
  if (/popup-closed|cancelled-popup/i.test(m)) return 'Login cancelado.';
  return 'Erro: ' + m;
}
async function comBusy(txt, fn) {
  ocupado(true, txt);
  try { return await fn(); } catch (e) { console.error(e); toast(msgErro(e), true); throw e; } finally { ocupado(false); }
}

/* ============ Firestore ============ */
async function lerConteudo(nome, seed, padrao) {
  const s = await getDoc(doc(db, 'conteudo', nome));
  if (s.exists() && s.data().json) return JSON.parse(s.data().json);
  try { return await R.json(seed); } catch (e) { return padrao; }   // ainda não migrado: parte do JSON do repositório
}
const gravarConteudo = (nome, obj) => setDoc(doc(db, 'conteudo', nome), { json: JSON.stringify(obj), atualizadoEm: serverTimestamp(), por: user.email });
const salvarFlyer = (id, dataUrl) => setDoc(doc(db, 'flyers', id), { data: dataUrl, atualizadoEm: serverTimestamp(), por: user.email });
async function apagarFlyer(ref) {
  if (!ref || !String(ref).startsWith('fb:')) return;
  const id = ref.slice(3);
  try { await deleteDoc(doc(db, 'flyers', id)); localStorage.removeItem('r84_fl_' + id); } catch (e) { console.warn(e); }
}

/* ============ imagem (comprime no celular; cabe no limite de 1 MB do Firestore) ============ */
async function comprimir(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  async function gerar(max, q) {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(res, 'image/jpeg', q));
  }
  let b = await gerar(1000, .75);
  if (b.size > 600 * 1024) b = await gerar(800, .6);
  if (b.size > 800 * 1024) throw new Error('Imagem muito pesada, tente outra.');
  return b;
}
const blobDataUrl = b => new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); });
const novoId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/* ============ telas ============ */
function telaLogin(erro) {
  app.innerHTML = `<div class="login"><div class="box">
    <img src="../assets/img/logo.jpg" alt="">
    <h1 class="display">Painel <span class="verde">Resenha084</span></h1>
    <p class="hint" style="margin:8px 0 18px">Entre com a sua conta Google autorizada.</p>
    <button class="btn btn-verde" id="google" style="width:100%">Entrar com Google</button>
    <div class="erro">${E(erro || '')}</div></div></div>`;
  $('#google').onclick = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { telaLogin(msgErro(e)); }
  };
}
function telaSemAcesso() {
  app.innerHTML = `<div class="login"><div class="box">
    <h1 class="display">Sem <span class="verde">acesso</span></h1>
    <p class="hint" style="margin:10px 0 18px">O e-mail <b>${E(user.email)}</b> não está autorizado. Peça a um editor para te adicionar na equipe.</p>
    <button class="btn btn-ghost" id="sair" style="width:100%">Sair e usar outra conta</button></div></div>`;
  $('#sair').onclick = () => signOut(auth);
}

async function entrar() {
  try {
    ocupado(true, 'Conferindo seu acesso…');
    const p = await getDoc(doc(db, 'papeis', user.email.toLowerCase()));
    papel = p.exists() ? p.data().papel : null;
    if (papel !== 'editor' && papel !== 'postador') { ocupado(false); return telaSemAcesso(); }
    const [e, l, s] = await Promise.all([
      lerConteudo('eventos', 'data/eventos.json', { eventos: [] }),
      lerConteudo('links', 'data/links.json', { links: [] }),
      lerConteudo('site', 'data/site.json', {})
    ]);
    st.eventos = e.eventos || []; st.links = l.links || []; site = s; st.linksSujo = false;
    if (papel !== 'editor') tab = 'eventos';
    ocupado(false); render();
  } catch (e) { ocupado(false); console.error(e); telaLogin(msgErro(e)); }
}

function render() {
  const abas = [['eventos', '🎶', 'Agenda']];
  if (papel === 'editor') abas.push(['links', '🔗', 'Links'], ['ajustes', '⚙️', 'Ajustes']);
  app.innerHTML = `<div class="ad">
    <div class="topo"><img src="../assets/img/logo.jpg" alt=""><h1 class="display">Painel</h1>
      <a class="btn btn-ghost btn-sm sair" href="../" target="_blank">Ver site ↗</a></div>
    <p class="hint" style="margin-top:-6px">${E(user.email)} · <b>${E(papel)}</b>${papel !== 'editor' ? '' : ''} · <a href="#" id="logout" style="color:var(--verde)">sair</a></p>
    <div id="conteudo"></div></div>
    ${abas.length > 1 ? `<nav class="tabs" style="grid-template-columns:repeat(${abas.length},1fr)">${abas.map(([k, i, n]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}"><span>${i}</span>${n}</button>`).join('')}</nav>` : ''}`;
  $('#logout').onclick = ev => { ev.preventDefault(); signOut(auth); };
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; render(); scrollTo(0, 0); });
  ({ eventos: abaEventos, links: abaLinks, ajustes: abaAjustes })[tab]();
}

/* ---------- AGENDA ---------- */
function miniAttr(e) {
  if (!e.flyer) return 'data-vazio="1"';
  return String(e.flyer).startsWith('fb:') ? `data-fb="${E(e.flyer.slice(3))}"` : `style="background-image:url('${E(R.url(e.flyer))}')"`;
}
function abaEventos() {
  const hoje = R.hojeStr();
  const ord = (a, b) => (a.data + (a.horario || '99')).localeCompare(b.data + (b.horario || '99'));
  const prox = st.eventos.filter(e => e.tipo !== 'fixo' && e.data >= hoje).sort(ord);
  const pass = st.eventos.filter(e => e.tipo !== 'fixo' && e.data < hoje).sort(ord).reverse();
  const fix = st.eventos.filter(e => e.tipo === 'fixo');
  const linha = (e, cls) => {
    const quando = e.tipo === 'fixo' ? 'Toda ' + R.DIAS[e.diaSemana] : (() => { const d = R.parseData(e.data); return `${R.DIAS_CURTO[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
    return `<div class="item ${cls || ''} ${e.publicado === false ? 'off' : ''}" data-id="${E(e.id)}">
      <div class="mini" ${miniAttr(e)}>${e.flyer ? '' : '🎶'}</div>
      <div class="t"><b>${E(e.titulo)}${e.publicado === false ? '<span class="pill rasc">rascunho</span>' : ''}</b><small>${E(quando)} · ${E(e.local || '')}</small></div>
      <div class="bt"><button class="ib" data-a="edit" title="Editar">✏️</button><button class="ib" data-a="dup" title="Duplicar">📄</button><button class="ib perigo" data-a="del" title="Apagar">🗑️</button></div></div>`;
  };
  $('#conteudo').innerHTML =
    `<div class="sec">Próximos (${prox.length})</div>${prox.map(e => linha(e)).join('') || '<div class="vazio">Nenhum evento futuro. Toque em ＋ pra cadastrar.</div>'}
     <div class="sec">Sambas fixos (${fix.length})</div>${fix.map(e => linha(e)).join('') || '<div class="vazio">Nenhum fixo.</div>'}
     ${pass.length ? `<div class="sec">Já passaram (${pass.length})</div>${pass.map(e => linha(e, 'passado')).join('')}` : ''}
     <button class="btn btn-verde fab" id="novo">＋ Novo evento</button>`;
  R.hidratar($('#conteudo'));
  $('#novo').onclick = () => formEvento();
  $('#conteudo').onclick = ev => {
    const b = ev.target.closest('[data-a]'); if (!b) return;
    const e = st.eventos.find(x => x.id === b.closest('.item').dataset.id);
    if (b.dataset.a === 'edit') formEvento(e);
    if (b.dataset.a === 'dup') formEvento({ ...e, id: null, data: '', flyer: e.flyer }, true);
    if (b.dataset.a === 'del') excluirEvento(e);
  };
}

async function excluirEvento(e) {
  if (!confirm(`Apagar "${e.titulo}"? Isso não dá pra desfazer.`)) return;
  const antes = st.eventos;
  try {
    await comBusy('Apagando…', async () => {
      st.eventos = st.eventos.filter(x => x.id !== e.id);
      await gravarConteudo('eventos', { eventos: st.eventos });
      // só apaga a imagem se nenhum outro evento (ex.: duplicado) usa o mesmo flyer
      if (e.flyer && !st.eventos.some(x => x.flyer === e.flyer)) await apagarFlyer(e.flyer);
    });
    toast('Apagado ✔'); render();
  } catch (x) { st.eventos = antes; render(); }
}

function formEvento(ev, duplicando) {
  const novo = !ev || duplicando;
  const e = ev || { tipo: 'unico', data: R.hojeStr(), publicado: true, gratis: false };
  let blobNovo = null, removeu = false;
  const dlg = $('#dlg');
  const dias = R.DIAS.map((d, i) => `<option value="${i}" ${e.diaSemana == i ? 'selected' : ''}>${d}</option>`).join('');
  dlg.innerHTML = `<form id="fEv">
    <h2 class="display">${novo ? 'Novo evento' : 'Editar evento'}</h2>
    <div class="flyer"><div class="prev" id="prev" ${e.flyer && String(e.flyer).startsWith('fb:') ? `data-fb="${E(e.flyer.slice(3))}"` : (e.flyer ? `style="background-image:url('${E(R.url(e.flyer))}')"` : '')}>${e.flyer ? '' : 'sem flyer'}</div>
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
  R.hidratar(dlg);
  const f = $('#fEv');
  const sync = () => { const fixo = f.tipo.value === 'fixo'; $('#lData').hidden = fixo; $('#lDia').hidden = !fixo; f.data.required = !fixo; $('#lPreco').hidden = f.gratis.checked; };
  f.tipo.onchange = sync; f.gratis.onchange = sync; sync();
  $('#cancela').onclick = () => dlg.close();
  $('#rmFlyer').onclick = () => { blobNovo = null; removeu = true; const p = $('#prev'); p.style.backgroundImage = ''; p.textContent = 'sem flyer'; };
  $('#arq').onchange = async () => {
    const file = $('#arq').files[0]; if (!file) return;
    try { blobNovo = await comprimir(file); removeu = false; $('#prev').textContent = ''; $('#prev').style.backgroundImage = `url('${URL.createObjectURL(blobNovo)}')`; }
    catch (x) { toast(x.message || 'Não consegui ler essa imagem.', true); }
  };
  f.onsubmit = async submit => {
    submit.preventDefault();
    const id = (novo ? null : e.id) || novoId('e');
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
    const flyerAntigo = e.flyer || '';
    const antes = st.eventos;
    try {
      await comBusy('Publicando…', async () => {
        if (blobNovo) { const fid = novoId('f'); await salvarFlyer(fid, await blobDataUrl(blobNovo)); obj.flyer = 'fb:' + fid; }
        const i = st.eventos.findIndex(x => x.id === id);
        st.eventos = i >= 0 ? st.eventos.map(x => x.id === id ? obj : x) : [...st.eventos, obj];
        await gravarConteudo('eventos', { eventos: st.eventos });
        // apaga o flyer antigo se foi trocado/removido e ninguém mais usa
        if (flyerAntigo && flyerAntigo !== obj.flyer && !st.eventos.some(x => x.flyer === flyerAntigo)) await apagarFlyer(flyerAntigo);
      });
      dlg.close(); toast('Publicado ✔ Já está no ar'); render();
    } catch (x) { st.eventos = antes; }
  };
  dlg.showModal();
}

/* ---------- LINKS (editor) ---------- */
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
    if (a === 'up' || a === 'down') { const j = a === 'up' ? i - 1 : i + 1; [st.links[i], st.links[j]] = [st.links[j], st.links[i]]; st.linksSujo = true; abaLinks(); }
    if (a === 'edit') formLink(i);
    if (a === 'del' && confirm(`Remover "${st.links[i].titulo}"?`)) { st.links.splice(i, 1); st.linksSujo = true; abaLinks(); }
  };
}
async function salvarLinks() {
  try { await comBusy('Publicando links…', () => gravarConteudo('links', { links: st.links })); st.linksSujo = false; toast('Links publicados ✔'); abaLinks(); } catch (x) { }
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
    const o = { id: l.id || novoId('l'), titulo: f.titulo.value.trim(), url, icone: f.icone.value.trim() || '🔗', destaque: f.destaque.checked, ativo: f.ativo.checked };
    if (i != null) st.links[i] = o; else st.links.push(o);
    st.linksSujo = true; dlg.close(); abaLinks();
  };
  dlg.showModal();
}

/* ---------- AJUSTES + EQUIPE (editor) ---------- */
async function abaAjustes() {
  const av = site.aoVivo || { dia: 3, hora: '20:30' };
  const ep = site.episodio || {};
  let blobEp = null;
  $('#conteudo').innerHTML = `
    <form class="box" id="fSite"><h2 class="display" style="font-size:24px;margin-bottom:14px">Site</h2>
      <label>Frase principal<input name="tagline" value="${E(site.tagline)}"></label>
      <label>Sobre o podcast (um item por linha)<textarea name="sobre">${E((site.sobre || []).join('\n'))}</textarea></label>
      <label>YouTube<input type="url" name="youtube" value="${E(site.youtube)}"></label>
      <label>Instagram<input type="url" name="instagram" value="${E(site.instagram)}"></label>
      <div class="row2"><label>Ao vivo — dia<select name="dia">${R.DIAS.map((d, i) => `<option value="${i}" ${av.dia == i ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <label>Horário<input type="time" name="hora" value="${E(av.hora)}"></label></div>
      <h2 class="display" style="font-size:22px;margin:6px 0 12px">Próximo episódio</h2>
      <p class="hint">Aparece em destaque no topo do site até a data passar. Deixe a data vazia pra esconder.</p>
      <div class="flyer"><div class="prev" id="prevEp" ${ep.banner && String(ep.banner).startsWith('fb:') ? `data-fb="${E(ep.banner.slice(3))}"` : (ep.banner ? `style="background-image:url('${E(R.url(ep.banner))}')"` : '')}>${ep.banner ? '' : 'sem banner'}</div>
        <input type="file" id="arqEp" accept="image/*">
        <label for="arqEp" class="btn btn-ghost btn-sm" style="margin:0;cursor:pointer;display:inline-flex">📷 Trocar banner</label></div>
      <div class="row2"><label>Data<input type="date" name="epData" value="${E(ep.data)}"></label>
      <label>Horário<input type="time" name="epHora" value="${E(ep.hora || av.hora)}"></label></div>
      <label>Convidado<input name="epConvidado" value="${E(ep.convidado)}"></label>
      <label>Apresentação<input name="epApres" value="${E(ep.apresentador)}"></label>
      <button class="btn btn-verde" style="width:100%">Publicar</button></form>
    <form class="box" id="fAudio"><h2 class="display" style="font-size:24px;margin-bottom:6px">Música de fundo</h2>
      <p class="hint">Toca sozinha no site em 15% (o visitante ajusta). Atual: <b>${E(site.audio && site.audio.off ? 'desligada' : (site.audio && site.audio.id ? site.audio.nome : 'música padrão do site'))}</b></p>
      <label>Enviar nova música (MP3, M4A, OGG, WAV — até 5 MB)<input type="file" id="arqAudio" accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav"></label>
      <p class="hint">Dica: no iPhone o MP3 e o M4A tocam em qualquer versão; OGG pode falhar em iPhones antigos.</p>
      <button class="btn btn-verde" style="width:100%">Enviar e publicar</button>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button type="button" class="btn btn-ghost btn-sm" id="audioOff">${site.audio && site.audio.off ? 'Ligar música' : 'Desligar música do site'}</button>
        ${site.audio && site.audio.id ? '<button type="button" class="btn btn-ghost btn-sm" id="audioPadrao">Voltar à música padrão</button>' : ''}</div></form>
    <div class="box" id="equipe"><h2 class="display" style="font-size:24px;margin-bottom:6px">Equipe</h2>
      <p class="hint">Editor faz tudo. Postador só mexe na agenda. A pessoa entra com a conta Google deste e-mail.</p>
      <div id="listaEquipe">Carregando…</div>
      <form id="fEq" style="margin-top:14px"><label>E-mail (Google)<input type="email" name="email" required placeholder="pessoa@gmail.com"></label>
        <label>Papel<select name="papel"><option value="postador">Postador (só agenda)</option><option value="editor">Editor (tudo)</option></select></label>
        <button class="btn btn-ghost" style="width:100%">Adicionar à equipe</button></form></div>`;
  R.hidratar($('#conteudo'));

  $('#arqEp').onchange = async () => {
    const file = $('#arqEp').files[0]; if (!file) return;
    try { blobEp = await comprimir(file); $('#prevEp').textContent = ''; $('#prevEp').style.backgroundImage = `url('${URL.createObjectURL(blobEp)}')`; }
    catch (x) { toast(x.message || 'Não consegui ler essa imagem.', true); }
  };
  $('#fSite').onsubmit = async ev => {
    ev.preventDefault(); const f = ev.target;
    const novo = {
      ...site, tagline: f.tagline.value.trim(), sobre: f.sobre.value.split('\n').map(x => x.trim()).filter(Boolean), youtube: f.youtube.value.trim(), instagram: f.instagram.value.trim(),
      aoVivo: { ...(site.aoVivo || {}), dia: Number(f.dia.value), hora: f.hora.value || '20:30', duracaoHoras: (site.aoVivo && site.aoVivo.duracaoHoras) || 2 },
      episodio: { data: f.epData.value, hora: f.epHora.value || '20:30', convidado: f.epConvidado.value.trim(), apresentador: f.epApres.value.trim(), banner: ep.banner || '' }
    };
    try {
      await comBusy('Publicando…', async () => {
        if (blobEp) { const fid = novoId('f'); await salvarFlyer(fid, await blobDataUrl(blobEp)); novo.episodio.banner = 'fb:' + fid; }
        await gravarConteudo('site', novo);
        if (blobEp && ep.banner) await apagarFlyer(ep.banner);
      });
      site = novo; toast('Publicado ✔'); abaAjustes();
    } catch (x) { }
  };

  /* ---- música de fundo: o arquivo é cortado em pedaços de ~700 KB (limite de 1 MB por documento) ---- */
  const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm' };
  const bytesB64 = u => { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
  async function apagarAudio(a) { for (let i = 0; i < (a.partes || 0); i++) { try { await deleteDoc(doc(db, 'audio', `${a.id}_${i}`)); } catch (x) { } } }
  async function salvarSite(novo, msg) { await gravarConteudo('site', novo); site = novo; toast(msg); abaAjustes(); }

  $('#fAudio').onsubmit = async ev => {
    ev.preventDefault();
    const file = $('#arqAudio').files[0];
    if (!file) return toast('Escolha um arquivo de áudio.', true);
    if (file.size > 5 * 1024 * 1024) return toast('Arquivo grande demais (máx. 5 MB). Use um MP3 mais leve.', true);
    const ext = file.name.split('.').pop().toLowerCase();
    const tipo = file.type && file.type.startsWith('audio/') ? file.type : (MIME[ext] || 'audio/mpeg');
    try {
      await comBusy('Enviando música…', async () => {
        const b64 = bytesB64(new Uint8Array(await file.arrayBuffer()));
        const id = novoId('a'), TAM = 700000, partes = Math.ceil(b64.length / TAM);
        for (let i = 0; i < partes; i++) {
          ocupado(true, `Enviando música… ${i + 1}/${partes}`);
          await setDoc(doc(db, 'audio', `${id}_${i}`), { d: b64.slice(i * TAM, (i + 1) * TAM) });
        }
        const antigo = site.audio;
        await gravarConteudo('site', (site = { ...site, audio: { id, nome: file.name, tipo, partes } }));
        if (antigo && antigo.id) await apagarAudio(antigo);
      });
      toast('Música publicada ✔ Já toca no site'); abaAjustes();
    } catch (x) { }
  };
  $('#audioOff').onclick = async () => {
    try { await comBusy('Salvando…', () => gravarConteudo('site', (site = { ...site, audio: { ...(site.audio || {}), off: !(site.audio && site.audio.off) } }))); toast('Salvo ✔'); abaAjustes(); } catch (x) { }
  };
  const padrao = $('#audioPadrao');
  if (padrao) padrao.onclick = async () => {
    if (!confirm('Apagar a música enviada e voltar à música padrão do site?')) return;
    try {
      await comBusy('Voltando ao padrão…', async () => { const antigo = site.audio; await gravarConteudo('site', (site = { ...site, audio: null })); await apagarAudio(antigo); });
      toast('Voltou à música padrão ✔'); abaAjustes();
    } catch (x) { }
  };

  async function listarEquipe() {
    const el = $('#listaEquipe');
    try {
      const snap = await getDocs(collection(db, 'papeis'));
      el.innerHTML = snap.docs.map(d => `<div class="item" data-email="${E(d.id)}"><div class="ic">👤</div>
        <div class="t"><b>${E(d.id)}</b><small>${E(d.data().papel)}${d.id === user.email.toLowerCase() ? ' · você' : ''}</small></div>
        <div class="bt">${d.id === user.email.toLowerCase() ? '' : '<button class="ib perigo" data-a="rm">🗑️</button>'}</div></div>`).join('') || '<div class="vazio">Ninguém ainda.</div>';
    } catch (x) { el.innerHTML = '<div class="vazio">Não consegui carregar a equipe.</div>'; }
  }
  listarEquipe();
  $('#listaEquipe').onclick = async ev => {
    const b = ev.target.closest('[data-a="rm"]'); if (!b) return;
    const email = b.closest('.item').dataset.email;
    if (!confirm(`Tirar ${email} da equipe?`)) return;
    try { await comBusy('Removendo…', () => deleteDoc(doc(db, 'papeis', email))); toast('Removido ✔'); listarEquipe(); } catch (x) { }
  };
  $('#fEq').onsubmit = async ev => {
    ev.preventDefault(); const f = ev.target; const email = f.email.value.trim().toLowerCase();
    try { await comBusy('Adicionando…', () => setDoc(doc(db, 'papeis', email), { papel: f.papel.value, adicionadoPor: user.email })); f.reset(); toast('Adicionado ✔'); listarEquipe(); } catch (x) { }
  };
}

/* ============ início ============ */
if (!R.fbOk()) {
  app.innerHTML = '<div class="login"><div class="box"><h1 class="display">Falta <span class="verde">configurar</span></h1><p class="hint" style="margin-top:10px">Preencha <b>assets/js/firebase-config.js</b> com os dados do Firebase.</p></div></div>';
} else {
  const fbApp = initializeApp(window.FB.config);
  auth = getAuth(fbApp); db = getFirestore(fbApp);
  onAuthStateChanged(auth, u => { user = u; if (u) entrar(); else telaLogin(); });
}
