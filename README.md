# Tom Certo

PWA mobile-first feito em HTML5, CSS3 e JavaScript puro para estimar tonalidade musical ou analisar o centro tonal de uma melodia cantada. O processamento de áudio é feito no aparelho.

## Arquivos do app

`index.html`, `style.css`, `app.js`, `manifest.json`, `sw.js`, `icon.svg`, `icon-192.png` e `icon-512.png`. O `app.js` implementa captura do microfone, visualizador/progresso, autocorrelação de pitch, cromagrama e correlação tonal.

## Publicação e instalação

Publique todos os arquivos na raiz de um site **HTTPS** — GitHub Pages, Netlify e Vercel são exemplos. Acesso ao microfone, instalação PWA e service worker precisam de HTTPS (ou `localhost` para desenvolvimento). No Android, instale pelo botão do app ou menu do Chrome; no iPhone/iPad, abra no Safari e escolha **Compartilhar → Adicionar à Tela de Início**.

Para reiniciar o teste durante validação, acrescente `?reset=1` ao endereço do app. Isso remove as chaves locais do Tom Certo deste navegador. Limpar todos os dados do site também apaga o estado local.

## Análise

**Modo Música** usa FFT/cromagrama nas 12 classes cromáticas e correlação de Krumhansl–Schmuckler para comparar as tonalidades maiores e menores. **Modo Voz** acompanha o pitch fundamental, descarta frames silenciosos ou não periódicos, agrupa notas estáveis e dá peso muito menor a passagens breves. A pontuação de tonalidade combina compatibilidade com escala, suporte à tônica e quinta, perfil tonal, nota de repouso e evidência condicional da terça. O mapeamento cromático trata enarmonias como E♯ = F e B♯ = C.

O Modo Voz mostra tonalidade estimada, nota de repouso, tempo de sustentação, confiança heurística, evidência da terça e classes de notas cantadas durante a janela. Se a terça não aparecer com força, o resultado avisa e a decisão usa os demais indícios. Tanto esse cálculo quanto a confiança são estimativas, não garantias teóricas: ruído, vibrato, acompanhamento alto, afinação e frases com poucas notas podem mudar a leitura. As janelas disponíveis são 12, 20, 25 e 30 segundos (25s por padrão).

## Teste e pagamento

O app inicia um período local de **15 minutos** e espelha o horário de início em mais de uma chave do armazenamento do navegador. Isso evita alguns resets acidentais, mas não é proteção contra adulteração: usuário pode limpar ou editar o `localStorage`, e qualquer regra executada apenas no navegador é contornável.

O botão Pix abre o link de cobrança Nubank configurado. Esta entrega estática não consulta o Nubank nem verifica comprovantes. Ao tocar em “Já paguei — Liberar Acesso”, o app grava imediatamente a liberação em chaves locais espelhadas e avisa que não confirma a transação. Para uma venda real, substitua essa regra por uma integração de servidor que valide a confirmação do provedor de pagamentos; não use o estado do navegador como prova de pagamento.
