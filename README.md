# Tom Certo

PWA mobile-first feito em HTML5, CSS3 e JavaScript puro para estimar o tom de uma música ou voz pelo microfone do aparelho.

## Arquivos

- `index.html` — interface, contador de teste e modais.
- `style.css` — tema escuro responsivo.
- `app.js` — captura de áudio, autocorrelação, cromagrama e correlação Krumhansl–Schmuckler; trial e instalação.
- `manifest.json` e `sw.js` — instalação PWA e cache do app shell.
- `icon.svg`, `icon-192.png` e `icon-512.png` — ícones.

## Publicar e instalar

Envie todos os arquivos para a raiz de uma hospedagem **HTTPS**, como GitHub Pages, Netlify ou Vercel. Permissão do microfone e service worker precisam de HTTPS, exceto em `localhost`. No Android, use **Instalar como App** ou o menu do Chrome. No iPhone/iPad, abra no Safari e escolha **Compartilhar → Adicionar à Tela de Início**.

Para testar um novo período grátis, acrescente `?reset=1` ao endereço publicado. Isso limpa as chaves de estado e liberação do Tom Certo no navegador atual. O contador normal dura 15 minutos e seu horário inicial é espelhado em mais de uma chave local.

## Análise de áudio

O app pede permissão ao microfone e processa o som localmente, sem gravá-lo ou enviá-lo. A cada amostra, usa RMS para filtrar silêncio, autocorrelação no domínio do tempo para uma estimativa de pitch e FFT para acumular energia nas 12 classes cromáticas. O cromagrama é comparado aos perfis maiores e menores de Krumhansl–Schmuckler. As janelas disponíveis são 12, 20, 25 e 30 segundos (25s por padrão). O resultado informa tom principal, relativo, confiança heurística e três notas mais presentes. É uma estimativa: ruído, acompanhamento denso, afinação fora do padrão ou mudanças de tonalidade podem afetá-la.

## Teste e pagamento

Ao fim dos 15 minutos, sem liberação local ativa, o app bloqueia novas análises e mostra o link Nubank configurado para R$ 1,99. O botão **Já paguei — Liberar Acesso** grava imediatamente a liberação em mais de uma chave local. Esta versão estática não consulta o Nubank nem confirma a transação; o aviso fica visível no modal. Armazenamento local não é mecanismo de segurança e pode ser editado ou removido. Para validar pagamento de forma confiável em um produto comercial, é necessária uma integração de servidor com o provedor de pagamentos.
