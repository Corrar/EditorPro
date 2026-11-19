# Revisão de código r2 — área seguranca-pwa

Bugs CONFIRMADOS por verificação adversarial (revisão feita sobre o commit 3090724; confira cada um no código atual antes de corrigir).

## Notas do revisor

Encontrei 2 bugs na área segurança-pwa: o cache do service worker cresce sem limite a cada deploy (média) e, depois de 'Sair', o editor abre offline sem login (baixa).

Não confirmei no app real: o servidor em localhost:3100 está quebrado. O .next do ep-int foi rebuildado às 12:29 e o next-server iniciado às 11:38 devolve 400 em todos os /_next/static, então o login não hidrata. Não o matei. Testei o SW num servidor mock em /tmp/claude-0/-home-user/aa48c5f3-da7a-51ea-a4c5-276a3a3dd31a/scratchpad/review/seguranca-pwa/mock.js, que serve o sw.js real do repo, com o script /tmp/claude-0/-home-user/aa48c5f3-da7a-51ea-a4c5-276a3a3dd31a/scratchpad/review/seguranca-pwa/sw2.js. A área não mudou entre 3090724 e o HEAD do checkout (2ed083b).

Conferido e sem bug:
- Matcher do middleware: testei no 3100 /index, /?_rsc, //, %2F, %61i, /API, ../, ;x, %00 e barra final. Tudo dá 307, 401 ou 404, nenhum bypass.
- Headers de bypass: x-middleware-subrequest (Next 14.2.35 já corrigido), x-invoke-path, RSC e outros continuam 401.
- /api/gen/* tem requireSession além do middleware.
- Comparação da senha em tempo constante sobre sha256, cookie HttpOnly + Secure + SameSite=Lax com expiração assinada.
- Sem DASH_PASSWORD, produção bloqueia tudo (fail-closed).
- O SW nunca cacheia /api/, não-GET nem Range. O HTML é network-first e os chunks têm hash, então o deploy novo chega na próxima abertura; não trava versão antiga.
- O SW é registrado só em produção.

Riscos que não viraram bug:
- /api/login não tem limite de tentativas. Com senha fraca, dá para chutar senhas contra a URL pública e gastar créditos da Anthropic.
- A chave do HMAC é a própria DASH_PASSWORD. Um cookie vazado permite descobrir a senha offline.
- Sem headers de segurança (CSP, nosniff, frame-ancestors). O SameSite=Lax já bloqueia clickjacking e CSRF autenticado.
- O addAll do install acontece sempre deslogado, porque o middleware manda para /login. Ele grava em '/' a página de login com redirected=true, e abrir offline antes do primeiro '/' online dá ERR_FAILED. Isso se corrige sozinho na primeira navegação logada (confirmado no mock).
- /api/logout aceita POST de outro site e desloga o usuário (só incômodo).
- Fora da minha área: getStatus() (lib/ai/client.ts) guarda qualquer falha, inclusive 401 ou rede, como 'demo' até um force.

## 1. [media] Service worker acumula os chunks de todo deploy num cache que nunca é limpo (cresce sem limite no celular)

- **Arquivo:** `web/public/sw.js:37`

**Cenário:** CACHE é fixo ('editorpro-v1', linha 2) e o sw.js é estático em public/, então o arquivo é idêntico byte a byte entre deploys. O navegador nunca instala um SW novo, o 'activate' (linha 13) nunca roda de novo e nada é removido. O ramo cache-first (linhas 37-46) grava toda resposta GET da mesma origem fora de /api/. Cada deploy troca o hash da maior parte dos chunks: o build de 09:55 e o de 12:29 têm 58 de 60 arquivos novos, e o editor carrega cerca de 1,4 MB de entrada mais até 0,33 MB lazy. Cada abertura do PWA depois de um deploy soma ~1,5 MB ao Cache Storage, para sempre. Testei com um servidor mock que serve o sw.js real e simulei 3 deploys: page-A/B/C/D.js e app-A/B/C/D.css ficaram todos guardados (4 MB, 16 entradas), nada foi podado. O Cache Storage conta em navigator.storage.estimate(), o mesmo número que canKeep() (lib/persist/pure.ts:160) usa para decidir se a galeria 'Recentes' guarda a mídia importada. Com semanas de deploys frequentes (várias integrações por dia), o PWA instalado do Bruno perde centenas de MB e a quota que o IndexedDB das mídias usa. A galeria Recentes para de guardar arquivos e o espaço só volta se ele limpar os dados do site.

**Correção proposta:** Versionar o SW por build e podar o cache. Exemplo: em next.config.mjs, expor env.NEXT_PUBLIC_BUILD = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now()). Registrar com navigator.serviceWorker.register('/sw.js?v=' + process.env.NEXT_PUBLIC_BUILD) e, no sw.js, usar const CACHE = 'editorpro-' + (new URL(location.href).searchParams.get('v') || 'dev'). Assim cada deploy instala um SW novo e o activate apaga os caches antigos. Também restringir o cache-first a url.pathname.startsWith('/_next/static/') e aos ícones da SHELL, em vez de cachear qualquer GET da origem. Opcional: limitar o número de entradas (aparar as mais antigas).

**Correção refinada pelo verificador:** Fazer o SW mudar a cada deploy e podar o cache. (1) Em next.config.mjs, expor env.NEXT_PUBLIC_BUILD = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now()). Registrar com navigator.serviceWorker.register('/sw.js?v=' + process.env.NEXT_PUBLIC_BUILD). No sw.js, usar const CACHE = 'editorpro-' + (new URL(self.location.href).searchParams.get('v') || 'dev'). Assim a URL do script muda, o navegador instala o SW novo e o activate apaga o cache do build anterior. (2) Independente disso, separar os estáticos com hash num cache próprio e limitar o número de entradas: depois de cada put, fazer cache.keys() e apagar as mais antigas acima de cerca de 200. Também restringir o cache-first a url.pathname.startsWith('/_next/static/') e aos itens de SHELL, em vez de cachear qualquer GET da origem. | Duas coisas complementares. (1) Restringir o cache-first a url.pathname.startsWith('/_next/static/') e aos ícones e ao manifest da SHELL. (2) Fazer a poda sem depender de versionar o SW. No ramo de navegação, quando a rede responder ok, ler a lista de scripts e links /_next/static referenciados no HTML novo e apagar do cache as entradas /_next/static que não estão nela. Outra opção, mais simples: limitar o cache a N entradas, por exemplo 300, apagando as mais antigas via cache.keys(), que vêm em ordem de inserção. Se for versionar, registrar '/sw.js?v=' + process.env.NEXT_PUBLIC_BUILD, com NEXT_PUBLIC_BUILD = VERCEL_GIT_COMMIT_SHA exposto pelo next.config.mjs, e derivar CACHE desse parâmetro dentro do sw.js. Assim o activate apaga o cache do build anterior. Nesse caso o shell offline é baixado de novo a cada deploy, o que é aceitável.
