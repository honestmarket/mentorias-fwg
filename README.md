# Plataforma de Mentorias FWG · Framework da Gestão

Mentorados, agenda, plano de trabalho, Canvas FWG (com registros datados e PDF), financeiro do mentor e Portal do Mentorado.

- Produção: https://mentorias-fwg.netlify.app (a Netlify publica a pasta `site/` a cada alteração na branch `main`)
- Banco, login e arquivos: Supabase, projeto `mentorias-fwg` (ref `wdnmmvxjxoqlztcnxopy`)
- Versão de desenvolvimento: artefato "Plataforma de Mentorias FWG" no Claude

## Espelhamento
A plataforma é desenvolvida no Claude e espelhada aqui. A pasta `claude/` guarda os arquivos exatamente
como estão no artefato; `src/build.py` gera o site a partir deles, trocando apenas a camada de dados.

| Pasta | Conteúdo |
|---|---|
| `claude/` | `index.html`, `canvas.html` e `vendor/` da versão do Claude (não editar à mão aqui) |
| `src/` | `shim.js` (Supabase no lugar das capacidades do Claude: banco, login, arquivos, downloads), `auth.css` e `build.py` |
| `site/` | O que vai ao ar (gerado) + `config.js` (URL e chave pública do Supabase) |
| `supabase/migrations/` | Alterações do banco, numeradas e sempre aditivas |

## Como atualizar
1. Copiar os arquivos novos do artefato para `claude/`.
2. Gerar o site: `python3 src/build.py claude site`
3. Commit e push na `main`: a Netlify publica sozinha. Os dados ficam no Supabase e não mudam com a publicação.

## Diferenças da versão hospedada
- Login do mentor por e-mail e senha (Supabase Auth). Só e-mails da tabela `admins` criam conta.
- Portal do Mentorado: o mentorado entra só com o usuário e a senha do portal, sem conta no Claude.
- Google Agenda: botão "Adicionar ao Google Agenda" (a sincronização automática usa o conector do Claude).
- Arquivos no bucket `arquivos` do Supabase, servidos em `/_blob/...` (nomes aleatórios, acessíveis por link).
