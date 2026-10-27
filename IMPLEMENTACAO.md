# Solicitações de compra — EngMalls

## Arquivos

- `index.html`: cópia do arquivo fornecido, com nova navegação, formulário de produtos, acompanhamento e integração do login por PIN com sessão no servidor. Os lançamentos e a conferência existentes foram preservados.
- `assets/solicitacoes.js`: formulário dinâmico, validações, envio, filtros, paginação de 15 registros, ordenação no servidor, detalhamento e atualização de status. Textos dos registros são escapados antes da renderização.
- `assets/solicitacoes.css`: estilos responsivos, usando as cores e fontes existentes.
- `supabase/solicitacoes.sql`: definição do banco, RPCs, permissões, RLS e adaptação do acesso por PIN. Deve ser executado como migração única pelo Supabase, não como comandos avulsos.

## Ativação coordenada

Ativação concluída em 26/10/2026 no projeto Supabase `kcgwbuedetqlxhyomoih` e em https://controle-compras-engmalls.vercel.app/. A atualização foi integrada pela PR #1. A migração foi aplicada em duas etapas coordenadas: `solicitacoes_infraestrutura` e `solicitacoes_ativacao_acesso`. Não executar novamente o SQL de instalação neste projeto. Os passos abaixo documentam o procedimento para instalação em outro ambiente.

1. Preparar uma implantação de prévia na Vercel com `index.html` e `assets/` na raiz. Não há build, framework ou nova dependência de produção.
2. Programar uma breve janela de manutenção. A migração restringe a leitura da tabela de usuários: a versão antiga, que consultava PIN diretamente, deixará de autenticar após a aplicação.
3. Aplicar `supabase/solicitacoes.sql` em uma única transação pelo mecanismo de migrações do Supabase. O SQL foi elaborado para a estrutura inspecionada do projeto `kcgwbuedetqlxhyomoih`; não é um script idempotente.
4. Promover imediatamente a nova versão para produção na Vercel. Os PINs atuais continuam válidos. Os usuários precisam entrar novamente.
5. Como administrador, abrir Cadastros → Usuários e marcar **Comprador** nos usuários responsáveis pelo acompanhamento. A migração não atribui esse perfil automaticamente. O campo PIN vazio ao editar mantém o PIN atual; credenciais existentes nunca são devolvidas ao navegador.
6. Conferir os três perfis no navegador, criação com vários produtos, campos vazios, urgência baixa, alteração de status, filtros, paginação e ordenação. Conferir também o bloqueio de leitura/alteração direta das tabelas por chamadas sem sessão ou com sessão comum. Executar os advisors de segurança do Supabase após aplicar a migração.

Não aplicar apenas a restrição dos usuários antes de publicar a nova versão.

## Protocolo e integridade

A data é calculada no banco no fuso `America/Sao_Paulo`. O protocolo é `DDMM` + sequência diária `01` a `99`. O contador usa `INSERT ... ON CONFLICT DO UPDATE`, que bloqueia a linha do dia durante a transação. Solicitação, produtos e contador são gravados juntos: erros revertem tudo. Há ainda `UNIQUE(dia, protocolo)` e um UUID interno.

O exemplo `271003` do pedido diverge do reinício diário descrito. Foi adotada a regra textual: a primeira solicitação do dia 27/10 recebe `271001`. Após 99 solicitações em um dia, o banco rejeita novos envios com mensagem clara. Se for necessário mais volume, o formato deve ser ampliado.

Seis dígitos sem ano não podem ser únicos globalmente para sempre: o mesmo protocolo pode reaparecer em outro ano. Por isso, a unicidade usa a data completa e o identificador interno é UUID. O filtro de protocolo pode retornar registros de anos diferentes, diferenciados pela coluna Data.

Cada envio também recebe uma chave de idempotência. Uma repetição do mesmo envio após falha de rede retorna o protocolo anterior, sem consumir outra sequência. O hash do conteúdo original fica no schema privado; se a chave for reutilizada com outro conteúdo, o banco informa o protocolo já registrado e solicita iniciar um novo envio. A chave permanece durante tentativas na mesma tela; um recarregamento inicia outro envio.

Urgência alta: limite de 24 horas após a criação. Média: 96 horas. Baixa: data futura obrigatória, exibida como disponibilidade **após** a data informada, sem convertê-la em prazo máximo. Quantidades aceitam até três casas decimais e os envios aceitam de 1 a 100 produtos. Uma solicitação aponta para uma única obra ativa.

## Acesso no backend

O sistema original não usa Supabase Auth: usa um PIN compartilhado por cadastro. A implementação mantém esse mecanismo e não passa a confiar no perfil salvo pelo navegador. O PIN é validado por RPC no banco, que gera um token aleatório de 256 bits. Apenas o hash fica no schema privado; a sessão dura 8 horas e é enviada no cabeçalho `x-eng-session`. Sair revoga a sessão no banco. Usuários desativados perdem acesso imediatamente e mudanças de perfil são avaliadas a cada requisição.

As funções privilegiadas ficam em `eng_private`, fora dos schemas expostos pela Data API, com `search_path` fixo. Os endpoints públicos são wrappers com `SECURITY INVOKER`. As funções internas validam a sessão PIN em vez de `auth.uid()`, pois não foi introduzido outro provedor de autenticação.

- Usuário comum: pode criar solicitações por RPC; não lê o acompanhamento nem altera status.
- Comprador: pode criar solicitações, ler o acompanhamento e alterar apenas a coluna status.
- Administrador (`is_master`): acompanha e altera status, além de administrar usuários. Não recebe formulário de solicitação.

As tabelas de solicitações têm RLS. O navegador não recebe permissão direta de INSERT/DELETE nem de alteração de obra, solicitante, protocolo ou produtos. A criação passa pela função transacional, que obtém o solicitante da sessão e valida produtos e obra. Os únicos updates diretos permitidos são da coluna status e exigem comprador ou administrador. O timestamp da alteração é atualizado por trigger.

A tabela de usuários deixa de permitir leitura de PIN e escrita anônima irrestrita, condição necessária para impedir que alguém obtenha um PIN de administrador ou se promova a administrador. O cadastro de comprador é protegido pelas mesmas regras.

As regras antigas dos demais módulos não foram reescritas. A inspeção identificou políticas públicas em compras e cadastros auxiliares; a proteção destes módulos permanece uma pendência anterior, fora do escopo da nova funcionalidade.

## Verificação realizada

- Sintaxe dos blocos JavaScript do HTML e do novo módulo verificada com o parser do Node.js.
- Conferência manual no navegador com dados fictícios: perfil comum sem acompanhamento, comprador com acompanhamento, administrador com navegação ERP, produtos múltiplos, prazo condicional, bloqueio de campos vazios, confirmação de protocolo, mudança de status e atualização dos cards, detalhe dos produtos e alternância visual da ordenação. Essas verificações não substituem a validação das consultas e políticas no banco real.
- Não foram criados testes automatizados nem adicionadas bibliotecas de produção.
- Migração aplicada no banco de produção; verificações transacionais com rollback confirmaram formato do protocolo, idempotência, produtos gravados juntos, restrição de leitura para usuário comum, leitura e alteração de status para comprador e bloqueio de alteração de campos protegidos.
- Após a ativação, acesso sem sessão não leu pedidos, não pôde consultar PIN nem criar administrador. Login, consulta da sessão e logout foram verificados dentro de transação revertida, sem persistir sessões de verificação.
- Produção verificada no navegador: novo formulário e módulo JavaScript carregados, sem erros de aplicação registrados. Não foi executado teste de concorrência real.
- Advisors: sem alertas de erro ou aviso na consulta. Há informes de RLS sem políticas nas tabelas privadas (bloqueio intencional de acesso direto) e no extrato bancário preexistente. Referência: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
