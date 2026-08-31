# Checkpoint — Meta Pixel Tracking (v5)
**Data:** 2026-08-31  
**Build tag:** `meta-track-funnel-v5`  
**Commit:** `7b87ac2`  
**Produção:** https://almagemela-steel.vercel.app/

---

## Funil acordado (VALIDADO ✅)

| Evento | Onde dispara | Arquivo / origem |
|--------|--------------|------------------|
| **PageView** | Carregamento do quiz | `index.html` (Pixel head) |
| **Lead** | Clique botão WA pós-VSL (slide 19, ~20s) | `js/vesto-global-rotator.js` |
| **InitiateCheckout** | Carregamento checkout Hotmart | Integração nativa Hotmart (`a=plhotmart`) |
| **Purchase** | Compra finalizada | Hotmart Pixel + CAPI nativos |

**Quiz NÃO dispara:** ViewContent, InitiateCheckout, Purchase, Contact.

---

## URLs de teste

- Quiz: https://almagemela-steel.vercel.app/
- Bridge checkout: https://almagemela-steel.vercel.app/mapa | /acesso
- Hotmart: https://pay.hotmart.com/J107108736M?checkoutMode=10
- Pixel ID: `38539014385698035`

---

## Arquivos-chave

- `index.html` — PageView + `autoConfig: false` + botão WA com `data-fb-disable-automatic-logging`
- `js/vesto-global-rotator.js` — Lead no clique `#btn-wa-carta`
- `js/meta-tracking-utils.js` — `trackOnce`, anti re-fire, eventID
- `mapa/index.html` / `acesso/index.html` — bridge: PageView + redirect 500ms (sem IC)
- `api/hotmart-webhook.js` — CAPI desligado por padrão (evita Purchase duplicado)
- `vercel.json` — sem redirect `/mapa` ou `/acesso`; só subdomínio `acesso.*` → Hotmart direto
- `tests/audit-tracking.js` — 21 testes (rodar: `node tests/audit-tracking.js`)

---

## Correções aplicadas nesta sessão

1. Lead movido para botão WA pós-VSL (removido de `startLoading`)
2. IC removido do slide 19 e das páginas bridge (só Hotmart)
3. Lead duplicado corrigido (`autoConfig: false` + `data-fb-disable-automatic-logging`)
4. `/mapa` e `/acesso` servem HTML 200 (não 302)

---

## Pendência menor (opcional)

- **Subdomínio `acesso.*`** no `vercel.json` ainda vai direto para Hotmart (pula bridge `/acesso`). IC na Hotmart funciona; PageView do bridge não.

---

## Legado (NÃO MEXER)

- `v777/` — funil antigo
- `leitura/` — order bump separado

---

## Próximos passos sugeridos

- [ ] Validar Purchase real no Events Manager após 1ª venda
- [ ] Opcional: redirect subdomínio `acesso.*` → `/acesso` em vez de Hotmart direto
- [ ] Monitorar Lead no Meta após tráfego real (confirmar sem duplicata)
