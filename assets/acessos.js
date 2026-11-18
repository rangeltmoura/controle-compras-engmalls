'use strict';
const Acessos = (() => {
  const campos = [
    ['solicitar', 'Solicitar compras', 'Criar solicitações de materiais.'],
    ['registrar', 'Registrar compras', 'Lançar compras e consultar os próprios lançamentos.'],
    ['acompanhar', 'Acompanhar solicitações', 'Consultar todas as solicitações e seus produtos.'],
    ['alterar_status', 'Alterar status', 'Atualizar o andamento das solicitações.'],
    ['conferir', 'Conferir compras', 'Consultar, editar, conferir e arquivar compras de todos os usuários.'],
    ['cadastros', 'Gerenciar cadastros', 'Manter obras, frentes, fornecedores e formas de pagamento.']
  ];
  const paginas = {nova:'solicitar',lancamento:'registrar',solicitacoes:'acompanhar',conferencia:'conferir',cadastros:'cadastros'};
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let rodada = 0;
  function pode(chave) { return Boolean(engenheiroAtual?.permissoes?.[chave]); }
  function permitePagina(pagina) { return pagina === 'acessos' ? Boolean(engenheiroAtual?.is_master) : pode(paginas[pagina]); }
  function aplicar() {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('oculto', !permitePagina(b.dataset.pagina)));
    document.querySelector('[data-aba="usuarios"]').classList.toggle('oculto', !engenheiroAtual?.is_master);
    document.getElementById('pagina-sem-acesso').classList.add('oculto');
  }
  async function atualizar() {
    const token = sessionStorage.getItem('eng-token');
    const {data,error} = await sb.rpc('eng_sessao');
    if (token !== sessionStorage.getItem('eng-token')) return false;
    if(error) throw new Error('Não foi possível verificar seus acessos. Tente novamente.');
    if(!data) { await sair(); return false; }
    engenheiroAtual=data; aplicar(); return true;
  }
  function inicial() { return Object.keys(paginas).find(permitePagina) || (engenheiroAtual?.is_master ? 'acessos' : 'sem-acesso'); }
  async function carregar() {
    const vez=++rodada, token=sessionStorage.getItem('eng-token');
    const lista=document.getElementById('acessos-lista'), msg=document.getElementById('acessos-msg');
    lista.replaceChildren(); msg.textContent='Carregando usuários...'; msg.className='msg';
    try {
      const {data,error}=await sb.rpc('eng_listar_acessos'); if(error)throw error;
      if(vez!==rodada || token!==sessionStorage.getItem('eng-token'))return;
      lista.innerHTML=(data||[]).map(u=>`<form class="acesso-usuario" data-usuario="${u.id}" data-versao="${u.versao}">
        <div class="acesso-cabecalho"><div><h2>${esc(u.nome)}</h2><span>${u.is_master?'Master · acesso administrativo completo':u.ativo?'Usuário ativo':'Usuário inativo'}</span></div>${u.is_master?'': '<button type="submit" class="sol-button">Salvar acessos</button>'}</div>
        ${u.is_master?'<p>Perfil protegido. Apenas os dois masters podem liberar acessos e administrar usuários.</p>':`<div class="acesso-opcoes">${campos.map(([k,t,d])=>`<label><input type="checkbox" name="${k}" ${u.permissoes[k]?'checked':''}><span><strong>${t}</strong><small>${d}</small></span></label>`).join('')}</div>`}
        <p class="msg acesso-resultado" role="status"></p></form>`).join('');
      msg.textContent='';
    }catch(e){if(vez===rodada){msg.textContent=e.message || 'Falha ao carregar acessos.';msg.className='msg erro';}}
  }
  function iniciar() {
    document.getElementById('pagina-nova').append(document.getElementById('sol-form-secao'));
    document.getElementById('acessos-atualizar').addEventListener('click',carregar);
    document.getElementById('acessos-lista').addEventListener('change',e=>{
      const f=e.target.closest('form'); if(!f)return;
      if(e.target.name==='alterar_status' && e.target.checked)f.elements.acompanhar.checked=true;
      if(e.target.name==='acompanhar' && !e.target.checked)f.elements.alterar_status.checked=false;
      f.querySelector('.acesso-resultado').textContent='Alterações ainda não salvas.';
    });
    document.getElementById('acessos-lista').addEventListener('submit',async e=>{
      e.preventDefault();const f=e.target,b=f.querySelector('button'),m=f.querySelector('.acesso-resultado');
      if(!b || b.disabled)return;
      const p=Object.fromEntries(campos.map(([k])=>[k,f.elements[k].checked]));
      b.disabled=true;f.querySelectorAll('input').forEach(i=>i.disabled=true);m.textContent='Salvando...';
      try{const {error}=await sb.rpc('eng_salvar_acessos',{p_usuario:Number(f.dataset.usuario),p_permissoes:p,p_versao:Number(f.dataset.versao)});if(error)throw error;
        f.dataset.versao=Number(f.dataset.versao)+1;m.textContent='Acessos salvos.';m.className='msg ok acesso-resultado';
      }catch(err){m.textContent=err.message || 'Erro ao salvar.';m.className='msg erro acesso-resultado';}
      finally{b.disabled=false;f.querySelectorAll('input').forEach(i=>i.disabled=false);}
    });
  }
  iniciar();
  return {pode,permitePagina,aplicar,atualizar,inicial,carregar};
})();
