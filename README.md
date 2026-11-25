# Tom Certo

PWA instalável e mobile-first para estimar a tonalidade de uma voz ou música no navegador, usando HTML, CSS e JavaScript puro.

## Arquivos

- `index.html` — estrutura, interface e modais.
- `style.css` — tema responsivo escuro.
- `app.js` — captura de áudio, autocorrelação para estimativa de pitch, cromagrama do espectro e correlação Krumhansl–Schmuckler.
- `manifest.json` e `sw.js` — configuração instalável e cache do app shell.
- `icon.svg`, `icon-192.png`, `icon-512.png` — ícones do app.

## Publicar

Envie todos os arquivos para a raiz de um site servido por **HTTPS** (por exemplo, GitHub Pages, Netlify ou Vercel). A permissão do microfone e a instalação PWA exigem HTTPS, exceto em `localhost`. Não abra `index.html` como arquivo local: o service worker não funciona nesse modo.

No Android, abra o endereço no Chrome e use o botão **Instalar como App** ou o menu do navegador. No iPhone/iPad, abra no Safari, toque em **Compartilhar → Adicionar à Tela de Início**.

Para testar o início do período grátis, abra `https://seu-dominio/?reset=1`. Isso apaga os dados locais do Tom Certo daquele navegador. Os dados são armazenados no `localStorage`; limpar dados do site também reinicia o teste.

## Importante: pagamento e acesso

Esta entrega é um site estático. O link Pix abre a cobrança indicada, mas o app **não consulta nem confirma pagamentos**. O botão “Já paguei — Liberar Acesso” espera quatro segundos e grava a liberação somente no `localStorage` deste navegador; a confirmação na interface deixa claro que isso não é validação de Pix. Em um produto comercial, não use esta liberação como prova de pagamento: integre um backend confiável ao provedor de pagamentos, confirme o webhook no servidor e emita uma autorização verificável. Tanto o limite de 24 horas quanto o desbloqueio local podem ser contornados pelo usuário, pois armazenamento e lógica cliente não são mecanismos de segurança.

O endereço de suporte no rodapé usa `suporte@tomcerto.app` como exemplo. Troque pelo e-mail real antes da publicação.

## Sobre a estimativa musical

O app analisa o áudio localmente, sem gravar nem transmitir a captura. A detecção de pitch por autocorrelação favorece fontes monofônicas; a estimativa tonal usa energia espectral agrupada em classes de nota e comparação com perfis Krumhansl–Schmuckler. “Confiança” é um indicador heurístico e não uma probabilidade calibrada. Ruído, reverberação, acompanhamento denso, afinação fora do padrão e mudanças de tonalidade podem afetar o resultado.

## Modos de análise

- **Modo Música:** mantém o cromagrama e a comparação Krumhansl–Schmuckler para estimar tonalidade maior/menor, relativa, confiança heurística e classes de notas mais presentes.
- **Modo Voz:** segue o pitch fundamental por autocorrelação a cada ~45 ms, descarta frames abaixo do limiar de energia/periodicidade, agrupa notas consecutivas estáveis e favorece notas sustentadas, especialmente quando uma pausa ou respiração vem em seguida. O resultado destaca uma nota de repouso estimada, tempo total de sustentação e notas de apoio.
- A janela pode ser 12, 20, 25 ou 30 segundos (25s padrão). A análise de voz é uma heurística melódica, não um identificador infalível de tonalidade — ruído, vibrato amplo, acompanhamento alto e melodia com poucas notas podem alterar a estimativa.
