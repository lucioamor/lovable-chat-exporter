# Lovable Chat Exporter 💬

Chrome extension que captura e exporta seu histórico de chat do Lovable como **Markdown**, **HTML**, ou **JSON**.

---

## Instalação (sem publicar na Chrome Store)

1. Abra o Chrome e vá para: `chrome://extensions/`
2. Ative o **"Modo do desenvolvedor"** (toggle no canto superior direito)
3. Clique em **"Carregar sem compactação"**
4. Selecione a pasta `lovable-exporter`

Pronto! O ícone da extensão vai aparecer na barra do Chrome.

---

## Como usar

### Botão na nav do Lovable
Ao entrar em qualquer projeto no Lovable, um botão **`Export (N)`** aparece na barra de navegação superior — no mesmo lugar onde o "Lovable Quick Transfer" coloca o botão de transferência.

- Clique no botão → um menu aparece com as opções
- **"Capture full history"** → rola automaticamente até o topo para capturar todas as mensagens anteriores (necessário porque o chat é virtualizado)
- **"Export as Markdown/HTML/JSON"** → baixa o arquivo

### Popup da extensão
Clique no ícone da extensão na barra do Chrome para ver:
- Quantas mensagens foram capturadas para o thread atual
- Botões de export e captura
- Opção de limpar os dados capturados

---

## Como funciona

O Lovable usa uma **lista virtualizada** — só ~20 mensagens ficam no DOM por vez. Por isso:

1. A extensão observa o DOM com `MutationObserver` e captura cada mensagem assim que ela entra na tela
2. Cada mensagem é identificada por `data-message-id` (ex: `umsg_...` para suas mensagens, `aimsg_...` para as do Lovable)
3. As mensagens são salvas no `chrome.storage.local` — sem limite de 5MB como o `localStorage`
4. **Não há duplicatas**: o ID único garante isso mesmo com recarregamentos

Para capturar o histórico **completo**, use "Capture full history" — a extensão vai rolar automaticamente até o topo e aguardar cada batch carregar.

---

## Estrutura dos arquivos

```
lovable-exporter/
├── manifest.json     # Configuração da extensão
├── content.js        # Script injetado no Lovable (captura + botão)
├── popup.html        # Interface do popup
├── popup.js          # Lógica do popup
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## Notas

- Os dados ficam **100% locais** no seu navegador — nada é enviado a servidores
- A extensão só ativa em `lovable.dev/*`
