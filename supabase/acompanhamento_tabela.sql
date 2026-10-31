-- Uma linha por produto; SECURITY INVOKER preserva as políticas RLS existentes.
create view public.solicitacoes_acompanhamento
with (security_invoker = true)
as
select i.id as item_id, s.id as solicitacao_id, s.protocolo, s.criado_em,
       i.descricao as produto, i.quantidade, o.nome as obra,
       e.nome as solicitante, i.urgencia,
       coalesce(i.prazo_limite,
         i.prazo_desejado::timestamp at time zone 'America/Sao_Paulo') as prazo_final,
       i.prazo_desejado, s.status
from public.solicitacao_itens i
join public.solicitacoes s on s.id = i.solicitacao_id
join public.obras o on o.id = s.obra_id
join public.engenheiros e on e.id = s.solicitante_id;
revoke all on public.solicitacoes_acompanhamento from public, anon, authenticated;
grant select on public.solicitacoes_acompanhamento to anon, authenticated;
notify pgrst, 'reload schema';
