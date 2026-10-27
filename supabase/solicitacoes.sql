-- Aplicar como uma única migração. Mantém o acesso por PIN existente.
create schema if not exists eng_private;
revoke all on schema eng_private from public;
grant usage on schema eng_private to anon, authenticated;
create extension if not exists pgcrypto with schema extensions;
alter table public.engenheiros add column is_comprador boolean not null default false;
create table eng_private.sessoes (
 token_hash text primary key, engenheiro_id bigint not null references public.engenheiros(id),
 expira_em timestamptz not null default now()+interval '8 hours'
);
create table eng_private.tentativas (origem text primary key, inicio timestamptz not null, quantidade integer not null);
create table eng_private.sequencias (dia date primary key, numero integer not null check(numero between 1 and 99));
alter table eng_private.sessoes enable row level security;
alter table eng_private.tentativas enable row level security;
alter table eng_private.sequencias enable row level security;
revoke all on all tables in schema eng_private from public,anon,authenticated;

create function eng_private.usuario() returns bigint language sql stable security definer set search_path='' as $$
 select s.engenheiro_id from eng_private.sessoes s join public.engenheiros e on e.id=s.engenheiro_id
 where s.token_hash=encode(extensions.digest(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-eng-session',''),'sha256'),'hex')
 and s.expira_em>now() and e.ativo
$$;
create function eng_private.master() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select is_master from public.engenheiros where id=eng_private.usuario()),false)
$$;
create function eng_private.gestor() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select is_master or is_comprador from public.engenheiros where id=eng_private.usuario()),false)
$$;
create function eng_private.login(p_pin text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_e public.engenheiros; v_token text; v_n integer;
 v_origem text := encode(extensions.digest(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-forwarded-for','local'),'sha256'),'hex');
begin
 insert into eng_private.tentativas values(v_origem,now(),1) on conflict(origem) do update
 set quantidade=case when eng_private.tentativas.inicio<now()-interval '5 minutes' then 1 else eng_private.tentativas.quantidade+1 end,
 inicio=case when eng_private.tentativas.inicio<now()-interval '5 minutes' then now() else eng_private.tentativas.inicio end returning quantidade into v_n;
 if v_n>15 then return jsonb_build_object('erro','Muitas tentativas. Aguarde 5 minutos.'); end if;
 if p_pin is null or p_pin !~ '^[0-9]{1,6}$' then return jsonb_build_object('erro','PIN incorreto.'); end if;
 select * into v_e from public.engenheiros where pin=p_pin and ativo;
 if not found then return jsonb_build_object('erro','PIN incorreto.'); end if;
 v_token:=encode(extensions.gen_random_bytes(32),'hex');
 delete from eng_private.sessoes where expira_em<now();
 insert into eng_private.sessoes(token_hash,engenheiro_id) values(encode(extensions.digest(v_token,'sha256'),'hex'),v_e.id);
 return jsonb_build_object('token',v_token,'usuario',jsonb_build_object('id',v_e.id,'nome',v_e.nome,'is_master',v_e.is_master,'is_comprador',v_e.is_comprador));
end $$;
create function public.eng_login(p_pin text) returns jsonb language sql security invoker set search_path='' as $$select eng_private.login(p_pin)$$;
create function eng_private.sessao() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'nome',nome,'is_master',is_master,'is_comprador',is_comprador) from public.engenheiros where id=eng_private.usuario()
$$;
create function public.eng_sessao() returns jsonb language sql security invoker set search_path='' as $$select eng_private.sessao()$$;
create function eng_private.logout() returns void language sql security definer set search_path='' as $$
 delete from eng_private.sessoes where token_hash=encode(extensions.digest(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-eng-session',''),'sha256'),'hex')
$$;
create function public.eng_logout() returns void language sql security invoker set search_path='' as $$select eng_private.logout()$$;

-- O PIN nunca é devolvido ao navegador; apenas o administrador altera usuários.
drop policy "leitura publica engenheiros" on public.engenheiros;
drop policy "insercao publica engenheiros" on public.engenheiros;
drop policy "atualizacao publica engenheiros" on public.engenheiros;
create policy engenheiros_leitura on public.engenheiros for select to anon,authenticated using((select eng_private.gestor()) or id=(select eng_private.usuario()));
create policy engenheiros_insercao on public.engenheiros for insert to anon,authenticated with check((select eng_private.master()));
create policy engenheiros_alteracao on public.engenheiros for update to anon,authenticated using((select eng_private.master())) with check((select eng_private.master()));
revoke all on public.engenheiros from anon,authenticated;
grant select(id,nome,ativo,is_master,is_comprador),insert(nome,pin,ativo,is_master,is_comprador),update(nome,pin,ativo,is_master,is_comprador) on public.engenheiros to anon,authenticated;

create table public.solicitacoes (
 id uuid primary key default gen_random_uuid(), dia date not null, protocolo text not null check(protocolo ~ '^[0-9]{6}$'),
 solicitante_id bigint not null references public.engenheiros(id), obra_id bigint not null references public.obras(id),
 status text not null default 'aguardando' check(status in ('aguardando','em cotação','aprovado','cancelado')),
 criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(), unique(dia,protocolo)
);
create table eng_private.envios (chave uuid primary key references public.solicitacoes(id), payload_hash text not null);
alter table eng_private.envios enable row level security;
revoke all on eng_private.envios from public,anon,authenticated;
create index solicitacoes_obra_idx on public.solicitacoes(obra_id);
create index solicitacoes_solicitante_idx on public.solicitacoes(solicitante_id);
create index solicitacoes_status_data_idx on public.solicitacoes(status,criado_em desc,id);
create table public.solicitacao_itens (
 id bigint generated always as identity primary key, solicitacao_id uuid not null references public.solicitacoes(id),
 posicao integer not null check(posicao>0), descricao text not null check(length(btrim(descricao)) between 1 and 500),
 quantidade numeric(14,3) not null check(quantidade>0 and quantidade<=99999999999.999),
 urgencia text not null check(urgencia in ('alta','média','baixa')), prazo_desejado date,
 prazo_limite timestamptz, unique(solicitacao_id,posicao),
 check((urgencia='baixa' and prazo_desejado is not null and prazo_limite is null) or (urgencia in ('alta','média') and prazo_desejado is null and prazo_limite is not null))
);
alter table public.solicitacoes enable row level security;
alter table public.solicitacao_itens enable row level security;
revoke all on public.solicitacoes,public.solicitacao_itens from public,anon,authenticated;
grant select on public.solicitacoes,public.solicitacao_itens to anon,authenticated;
grant update(status) on public.solicitacoes to anon,authenticated;
create policy solicitacoes_leitura on public.solicitacoes for select to anon,authenticated using((select eng_private.gestor()));
create policy solicitacoes_status on public.solicitacoes for update to anon,authenticated using((select eng_private.gestor())) with check((select eng_private.gestor()));
create policy itens_leitura on public.solicitacao_itens for select to anon,authenticated using((select eng_private.gestor()));
create function eng_private.marcar_atualizacao() returns trigger language plpgsql set search_path='' as $$begin new.atualizado_em:=now(); return new; end$$;
create trigger solicitacoes_atualizacao before update on public.solicitacoes for each row execute function eng_private.marcar_atualizacao();

create function eng_private.criar(p_obra bigint,p_itens jsonb,p_chave uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_usuario bigint:=eng_private.usuario(); v_dia date:=(now() at time zone 'America/Sao_Paulo')::date;
 v_n integer; v_protocolo text; v_item jsonb; v_pos integer:=0; v_q numeric; v_prazo date; v_existente public.solicitacoes;
begin
 if v_usuario is null then raise exception 'Sessão expirada. Entre novamente.' using errcode='42501'; end if;
 if eng_private.master() then raise exception 'A solicitação é destinada a usuários não administradores.' using errcode='42501'; end if;
 if p_chave is null then raise exception 'Identificador do envio obrigatório.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_chave::text,0));
 select * into v_existente from public.solicitacoes where id=p_chave;
 if found then
 if v_existente.solicitante_id<>v_usuario then raise exception 'Identificador de envio inválido.'; end if;
 if not exists(select 1 from eng_private.envios where chave=p_chave and payload_hash=encode(extensions.digest(p_obra::text||p_itens::text,'sha256'),'hex')) then
 raise exception 'Este envio já foi registrado com protocolo %. Recarregue a tela para iniciar outra solicitação.',v_existente.protocolo; end if;
 return jsonb_build_object('id',v_existente.id,'protocolo',v_existente.protocolo,'dia',v_existente.dia); end if;
 if not exists(select 1 from public.obras where id=p_obra and ativo) then raise exception 'Selecione uma obra ativa.'; end if;
 if jsonb_typeof(p_itens) is distinct from 'array' then raise exception 'Informe os produtos.'; end if;
 if jsonb_array_length(p_itens) not between 1 and 100 then raise exception 'Informe de 1 a 100 produtos.'; end if;
 -- ON CONFLICT serializa os envios do mesmo dia; toda a operação é uma transação.
 insert into eng_private.sequencias values(v_dia,1) on conflict(dia) do update set numero=eng_private.sequencias.numero+1
 where eng_private.sequencias.numero<99 returning numero into v_n;
 if v_n is null then raise exception 'Limite de 99 solicitações atingido hoje. Contate o administrador.'; end if;
 v_protocolo:=to_char(v_dia,'DDMM')||lpad(v_n::text,2,'0');
 insert into public.solicitacoes(id,dia,protocolo,solicitante_id,obra_id) values(p_chave,v_dia,v_protocolo,v_usuario,p_obra);
 insert into eng_private.envios values(p_chave,encode(extensions.digest(p_obra::text||p_itens::text,'sha256'),'hex'));
 for v_item in select value from jsonb_array_elements(p_itens) loop
 v_pos:=v_pos+1;
 if jsonb_typeof(v_item) is distinct from 'object' or jsonb_typeof(v_item->'descricao') is distinct from 'string'
 or length(btrim(v_item->>'descricao')) not between 1 and 500 then raise exception 'Produto %: informe uma descrição de até 500 caracteres.',v_pos; end if;
 if coalesce(v_item->>'quantidade','') !~ '^[0-9]+([.][0-9]{1,3})?$' then raise exception 'Produto %: quantidade inválida (até 3 casas decimais).',v_pos; end if;
 v_q:=(v_item->>'quantidade')::numeric;
 if v_q<=0 or v_q>99999999999.999 then raise exception 'Produto %: quantidade fora do intervalo permitido.',v_pos; end if;
 if coalesce(v_item->>'urgencia','') not in ('alta','média','baixa') then raise exception 'Produto %: selecione a urgência.',v_pos; end if;
 v_prazo:=null;
 if v_item->>'urgencia'='baixa' then
 if coalesce(v_item->>'prazo_desejado','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Produto %: informe o prazo desejado.',v_pos; end if;
 v_prazo:=(v_item->>'prazo_desejado')::date;
 if v_prazo<=v_dia then raise exception 'Produto %: o prazo desejado deve ser futuro.',v_pos; end if;
 end if;
 insert into public.solicitacao_itens(solicitacao_id,posicao,descricao,quantidade,urgencia,prazo_desejado,prazo_limite)
 values(p_chave,v_pos,btrim(v_item->>'descricao'),v_q,v_item->>'urgencia',v_prazo,
 case v_item->>'urgencia' when 'alta' then now()+interval '1 day' when 'média' then now()+interval '4 days' else null end);
 end loop;
 return jsonb_build_object('id',p_chave,'protocolo',v_protocolo,'dia',v_dia);
end$$;
create function public.criar_solicitacao(p_obra bigint,p_itens jsonb,p_chave uuid) returns jsonb language sql security invoker set search_path='' as $$select eng_private.criar(p_obra,p_itens,p_chave)$$;
create function public.resumo_solicitacoes() returns table(status text,quantidade bigint) language sql stable security invoker set search_path='' as $$select status,count(*) from public.solicitacoes group by status$$;

revoke all on all functions in schema eng_private from public,anon,authenticated;
grant execute on function eng_private.usuario(),eng_private.master(),eng_private.gestor(),eng_private.login(text),eng_private.sessao(),eng_private.logout(),eng_private.criar(bigint,jsonb,uuid) to anon,authenticated;
revoke all on function public.eng_login(text),public.eng_sessao(),public.eng_logout(),public.criar_solicitacao(bigint,jsonb,uuid),public.resumo_solicitacoes() from public;
grant execute on function public.eng_login(text),public.eng_sessao(),public.eng_logout(),public.criar_solicitacao(bigint,jsonb,uuid),public.resumo_solicitacoes() to anon,authenticated;
notify pgrst,'reload schema';
