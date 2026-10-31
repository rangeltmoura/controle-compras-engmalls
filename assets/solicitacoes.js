'use strict';
// Usa o cliente e a navegação existentes; o banco valida a sessão em cada operação.
const Solicitacoes = (() => {
 const estados = ['aguardando', 'em cotação', 'aprovado', 'cancelado'];
 const esc = valor => String(valor ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const el = id => document.getElementById(id);
 let pagina=0, coluna='criado_em', crescente=false, versao=0, chave=crypto.randomUUID();
 const tamanho=15;
 let filtrosProntos=false;
 const gestor=()=>Boolean(engenheiroAtual && (engenheiroAtual.is_master || engenheiroAtual.is_comprador));
 function hoje(){const partes=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const valor=tipo=>partes.find(p=>p.type===tipo).value;return `${valor('year')}-${valor('month')}-${valor('day')}`;}
 function futuro(){const d=new Date(hoje()+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
 function data(valor){return valor ? new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(valor)) : '—';}
 function dataCurta(valor){return valor ? new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short'}).format(new Date(valor)) : '—';}
 function mensagem(id,texto,erro=false){el(id).textContent=texto;el(id).className=erro?'msg erro':'msg ok';}
 function produto(){
 const campo=document.createElement('fieldset');campo.className='sol-produto';
 const id=crypto.randomUUID();
 campo.innerHTML=`<legend>Produto</legend><label for="desc-${id}">Descrição do produto</label><input id="desc-${id}" class="sol-descricao" required maxlength="500"><label for="qtd-${id}">Quantidade estimada</label><input id="qtd-${id}" class="sol-quantidade" type="number" min="0.001" max="99999999999.999" step="0.001" required><label for="urg-${id}">Grau de urgência</label><select id="urg-${id}" class="sol-urgencia" required><option value="">Selecione...</option><option value="alta">Alta — imediata, no máximo 1 dia</option><option value="média">Média — pode esperar 4 dias</option><option value="baixa">Baixa — após a data informada</option></select><div class="sol-prazo-wrap oculto"><label for="prazo-${id}">Prazo desejado</label><input id="prazo-${id}" class="sol-prazo" type="date" min="${futuro()}"><p class="sol-ajuda">Disponibilidade para compra após esta data.</p></div><button type="button" class="sol-button sol-remover">Remover produto</button>`;
 campo.querySelector('.sol-urgencia').addEventListener('change',e=>{const baixa=e.target.value==='baixa';campo.querySelector('.sol-prazo-wrap').classList.toggle('oculto',!baixa);const prazo=campo.querySelector('.sol-prazo');prazo.required=baixa;prazo.disabled=!baixa;if(!baixa)prazo.value='';});
 campo.querySelector('.sol-remover').addEventListener('click',()=>{campo.remove();numerar();});
 el('sol-produtos').append(campo);numerar();
 }
 function numerar(){const campos=el('sol-produtos').children;Array.from(campos).forEach((campo,i)=>{campo.querySelector('legend').textContent=`Produto ${i+1}`;campo.querySelector('.sol-remover').disabled=campos.length===1;});el('sol-adicionar').disabled=campos.length>=100;}
 async function obras(){
 const {data:lista,error}=await sb.from('obras').select('id,nome').eq('ativo',true).order('nome');
 if(error)throw new Error('Não foi possível carregar as obras. Tente novamente.');
 el('sol-obra').innerHTML='<option value="">Selecione...</option>'+lista.map(o=>`<option value="${esc(o.id)}">${esc(o.nome)}</option>`).join('');
 if(!lista.length)mensagem('sol-msg','Nenhuma obra ativa cadastrada. Solicite o cadastro ao administrador.',true);
 }
 async function enviar(e){
 e.preventDefault();const form=e.target;mensagem('sol-msg','');
 const campos=Array.from(el('sol-produtos').children);
 campos.forEach(c=>{const d=c.querySelector('.sol-descricao');d.setCustomValidity(d.value.trim()?'':'Informe a descrição do produto.');const p=c.querySelector('.sol-prazo');p.min=futuro();});
 if(!form.reportValidity())return;
 const itens=campos.map(c=>({descricao:c.querySelector('.sol-descricao').value.trim(),quantidade:c.querySelector('.sol-quantidade').value,urgencia:c.querySelector('.sol-urgencia').value,prazo_desejado:c.querySelector('.sol-prazo').value||null}));
 const sessaoEnvio=sessionStorage.getItem('eng-token');
 const botao=el('sol-enviar');botao.disabled=true;
 // Mantém a chave após falhas de rede: repetir o envio não cria outra solicitação.
 try{const {data:retorno,error}=await sb.rpc('criar_solicitacao',{p_obra:el('sol-obra').value,p_itens:itens,p_chave:chave});if(error)throw error;
 if(sessaoEnvio!==sessionStorage.getItem('eng-token'))return;
 mensagem('sol-msg',`Solicitação enviada com sucesso! Protocolo: ${retorno.protocolo}`);el('sol-msg').classList.add('sol-protocolo');
 form.reset();el('sol-produtos').replaceChildren();produto();chave=crypto.randomUUID();el('sol-msg').focus();
 }catch(erro){mensagem('sol-msg',erro.message||'Falha de conexão. Tente enviar novamente.',true);}finally{botao.disabled=false;}
 }
 function comum(tela){el('sol-form-secao').classList.toggle('oculto',tela!=='nova');el('bloco-lancamento-comum').classList.toggle('oculto',tela!=='lancamento');document.querySelector('#app-comum-conteudo > .historico').classList.toggle('oculto',tela!=='lancamento');el('sol-acomp-comum').classList.toggle('oculto',tela!=='acomp');document.querySelectorAll('[data-sol-tela]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.solTela===tela)));if(tela==='acomp'){el('sol-acomp-comum').append(el('sol-acomp'));pagina=0;carregar();}if(tela==='nova')obras().catch(e=>mensagem('sol-msg',e.message,true));}
 function entrar(){
 el('sol-acomp').classList.toggle('oculto',!gestor());
 el('sol-nav-acomp').classList.toggle('oculto',!gestor());
 if(engenheiroAtual.is_master){el('pagina-solicitacoes').append(el('sol-acomp'));}
 else{el('sol-acomp-comum').append(el('sol-acomp'));comum('nova');}
 }
 async function carregarFiltros(rodada){
 if(filtrosProntos)return;
 const [obras,usuarios]=await Promise.all([
 sb.from('obras').select('nome').order('nome'),
 sb.from('engenheiros').select('nome').order('nome')
 ]);
 if(rodada!==versao)return;
 if(obras.error||usuarios.error)throw new Error('Não foi possível carregar os filtros. Clique em Filtrar / Atualizar para tentar novamente.');
 const preencher=(id,lista,inicial)=>{const select=el(id),valor=select.value;const nomes=[...new Set((lista||[]).map(r=>r.nome).filter(Boolean))];select.innerHTML=`<option value="">${inicial}</option>`+nomes.map(nome=>`<option value="${esc(nome)}">${esc(nome)}</option>`).join('');if(nomes.includes(valor))select.value=valor;};
 preencher('sol-filtro-obra',obras.data,'Todas');
 preencher('sol-filtro-solicitante',usuarios.data,'Todos');
 filtrosProntos=true;
 }
 async function carregar(){
 if(!gestor())return;
 const rodada=++versao;mensagem('sol-lista-msg','Carregando...');el('sol-anterior').disabled=true;el('sol-proxima').disabled=true;el('sol-linhas').replaceChildren();
 try{
 await carregarFiltros(rodada);
 if(rodada!==versao)return;
 let consulta=sb.from('solicitacoes_acompanhamento').select('item_id,solicitacao_id,protocolo,criado_em,produto,quantidade,obra,solicitante,urgencia,prazo_final,prazo_desejado,status',{count:'exact'});
 const status=el('sol-filtro-status').value,protocolo=el('sol-filtro-protocolo').value.trim();
 if(status)consulta=consulta.eq('status',status);if(protocolo)consulta=consulta.like('protocolo',protocolo+'%');
 const obra=el('sol-filtro-obra').value,urgencia=el('sol-filtro-urgencia').value,solicitante=el('sol-filtro-solicitante').value;
 if(obra)consulta=consulta.eq('obra',obra);
 if(urgencia)consulta=consulta.eq('urgencia',urgencia);
 if(solicitante)consulta=consulta.eq('solicitante',solicitante);
 const [lista,resumo]=await Promise.all([consulta.order(coluna,{ascending:crescente,nullsFirst:false}).order('item_id',{ascending:true}).range(pagina*tamanho,(pagina+1)*tamanho-1),sb.rpc('resumo_solicitacoes')]);
 if(rodada!==versao)return;if(lista.error)throw lista.error;if(resumo.error)throw resumo.error;
 const total=lista.count||0;if(pagina>0&&pagina*tamanho>=total){pagina=Math.max(0,Math.ceil(total/tamanho)-1);return carregar();}
 const todos=(resumo.data||[]).reduce((n,r)=>n+Number(r.quantidade),0);
 el('sol-cards').innerHTML=estados.map(s=>{const qtd=Number(resumo.data.find(r=>r.status===s)?.quantidade||0);return `<article class="sol-card"><span>${esc(s)}</span><strong>${qtd}</strong><span>${(todos?qtd/todos*100:0).toLocaleString('pt-BR',{maximumFractionDigits:1})}% do total</span></article>`;}).join('');
 el('sol-linhas').innerHTML=lista.data.map(s=>`<tr><td class="sol-data" title="${esc(data(s.criado_em))}">${esc(dataCurta(s.criado_em))}</td><td class="sol-descricao-tabela">${esc(s.produto)}</td><td class="sol-numero">${esc(Number(s.quantidade).toLocaleString('pt-BR',{maximumFractionDigits:3}))}</td><td>${esc(s.obra||'—')}</td><td>${esc(s.solicitante||'—')}</td><td>${esc(s.urgencia.charAt(0).toUpperCase()+s.urgencia.slice(1))}</td><td class="sol-data" title="${esc(s.urgencia==='baixa'?'Disponibilidade após a data informada':data(s.prazo_final))}">${s.urgencia==='baixa'?'Após ':''}${esc(s.prazo_desejado?s.prazo_desejado.split('-').reverse().join('/'):dataCurta(s.prazo_final))}</td><td><select aria-label="Status do protocolo ${esc(s.protocolo)}, produto ${esc(s.produto)}" data-sol-status="${esc(s.solicitacao_id)}">${estados.map(v=>`<option ${v===s.status?'selected':''}>${esc(v)}</option>`).join('')}</select></td><td class="sol-data">${esc(s.protocolo)}</td></tr>`).join('');
 el('sol-pagina').textContent=`Página ${pagina+1} de ${Math.max(1,Math.ceil(total/tamanho))} · ${total} ${total===1?'produto':'produtos'}`;
 el('sol-anterior').disabled=pagina===0;el('sol-proxima').disabled=(pagina+1)*tamanho>=total;
 mensagem('sol-lista-msg',total?'':'Nenhuma solicitação encontrada.');
 document.querySelectorAll('[data-sol-ordem]').forEach(b=>{const ativo=b.dataset.solOrdem===coluna;b.parentElement.setAttribute('aria-sort',ativo?(crescente?'ascending':'descending'):'none');b.querySelector('span').textContent=ativo?(crescente?' ↑':' ↓'):' ↕';b.title=ativo&&crescente?'Ordenar do maior para o menor / Z–A':'Ordenar do menor para o maior / A–Z';});
 }catch(e){if(rodada===versao)mensagem('sol-lista-msg',e.message||'Não foi possível carregar as solicitações.',true);}
 }
 function iniciar(){
 produto();el('sol-form').addEventListener('submit',enviar);el('sol-form').addEventListener('input',e=>{if(e.target.matches('.sol-descricao'))e.target.setCustomValidity('');});
 el('sol-adicionar').addEventListener('click',produto);document.querySelectorAll('[data-sol-tela]').forEach(b=>b.addEventListener('click',()=>comum(b.dataset.solTela)));
 el('sol-filtros').addEventListener('submit',e=>{e.preventDefault();if(!e.target.reportValidity())return;filtrosProntos=false;pagina=0;carregar();});
 el('sol-anterior').addEventListener('click',()=>{pagina--;carregar();});el('sol-proxima').addEventListener('click',()=>{pagina++;carregar();});
 document.querySelectorAll('[data-sol-ordem]').forEach(b=>b.addEventListener('click',()=>{crescente=coluna===b.dataset.solOrdem?!crescente:true;coluna=b.dataset.solOrdem;pagina=0;carregar();}));
 el('sol-linhas').addEventListener('change',async e=>{const select=e.target.closest('[data-sol-status]');if(!select)return;select.disabled=true;try{const {data:alterados,error}=await sb.from('solicitacoes').update({status:select.value}).eq('id',select.dataset.solStatus).select('id');if(error)throw error;if(!alterados.length)throw new Error('Sem permissão para alterar. Entre novamente.');await carregar();}catch(erro){await carregar();mensagem('sol-lista-msg',erro.message,true);}finally{select.disabled=false;}});
 }
 function sair(){versao++;filtrosProntos=false;el('sol-filtros').reset();el('sol-filtro-obra').innerHTML='<option value="">Todas</option>';el('sol-filtro-solicitante').innerHTML='<option value="">Todos</option>';el('sol-acomp').classList.add('oculto');el('sol-linhas').replaceChildren();el('sol-cards').replaceChildren();el('sol-form').reset();el('sol-produtos').replaceChildren();produto();chave=crypto.randomUUID();mensagem('sol-msg','');mensagem('sol-lista-msg','');}
 return {iniciar,entrar,carregar,sair};
})();
Solicitacoes.iniciar();
