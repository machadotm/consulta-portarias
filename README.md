# Extração de Portarias no DOU — CGLic/IPHAN

Sistema de coleta, armazenamento e consulta das portarias de autorização de pesquisa arqueológica publicadas no **Diário Oficial da União (DOU)**, desenvolvido pela equipe da Coordenação-Geral de Licenciamento Ambiental (CGLic) do IPHAN.

**Sistema em produção:** https://consulta-portarias.vercel.app/
**Módulo histórico (1991–2025):** https://banco-portarias-cna.vercel.app/

---

## Contexto

A Instrução Normativa IPHAN nº 6/2025 (§1º do Art. 46) condiciona a concessão de nova autorização de pesquisa arqueológica à comprovação da **exequibilidade** de todos os projetos do arqueólogo coordenador de campo. Para realizar essa verificação, os técnicos em Arqueologia da CGLic precisam consultar, com segurança e rapidez, as portarias vigentes de cada profissional.

Antes deste sistema, a consulta dependia de uma planilha estática publicada no site do IPHAN (mais de 32 mil registros desde 1991), atualizada de forma irregular, sem coluna para o coordenador de campo, sem link para o DOU e sem status de vigência. Este projeto substitui esse fluxo por uma base extraída diretamente do DOU, atualizada a cada publicação (terças e sextas-feiras) e consultável em tempo real.

## Arquitetura

```
┌─────────────────────┐
│  DOU (in.gov.br)    │  Fonte primária: portarias do IPHAN
└─────────┬───────────┘
          │  link da edição (operador)
          ▼
┌─────────────────────┐
│  Script R           │  Web scraping + tratamento
│  (extração)         │  Script_Scraping_Portarias_R.R
└─────────┬───────────┘
          │  API REST (insert)
          ▼
┌─────────────────────┐
│  Supabase           │  PostgreSQL em nuvem
│  portarias_iphan    │  chave composta única (portaria + processo)
└─────────┬───────────┘
          │  @supabase/supabase-js
          ▼
┌─────────────────────┐
│  Next.js + Vercel   │  Site de consulta (src/app/page.tsx)
│  + Vercel Analytics │  https://consulta-portarias.vercel.app/
└─────────────────────┘
```

O sistema é complementado por um **módulo histórico** ([banco-portarias-cna.vercel.app](https://banco-portarias-cna.vercel.app/)), que converteu a planilha do Centro Nacional de Arqueologia (CNA, 1991–2025) em base pesquisável, interligada ao sistema principal pelo cabeçalho. Juntos, os dois módulos cobrem todo o período de autorizações.

## Stack

| Camada | Tecnologia |
|---|---|
| Extração | R (rvest/httr/dplyr) — `Script_Scraping_Portarias_R.R` |
| Banco de dados | Supabase (PostgreSQL, plano gratuito) |
| Front-end | Next.js 16 · React 19 · Tailwind CSS 4 · TypeScript |
| Hospedagem | Vercel |
| Métricas | Vercel Analytics (`@vercel/analytics`) |

## Estrutura do repositório

```
├── Script_Scraping_Portarias_R.R   # Script de extração (R) — documentado no cabeçalho
├── src/app/page.tsx                # Interface de consulta (componente único)
├── src/app/layout.tsx              # Layout base + Vercel Analytics
├── public/                         # Assets estáticos
├── package.json
└── README.md
```

## O script de extração (R)

O `Script_Scraping_Portarias_R.R` recebe o link de uma edição do DOU e extrai, de cada anexo, os itens de autorização/permissão/renovação — **uma linha por autorização**. O cabeçalho do próprio script documenta uso, parâmetros, saída e decisões de projeto. Resumo:

**Uso:**

```r
links <- c("https://www.in.gov.br/web/dou/-/portaria-n-XX-de-...")
df <- scrape_portarias(links)                  # execução normal
df <- scrape_portarias(links, verbose = TRUE)  # log detalhado para depuração

# Exportação para Excel sem quebrar acentos (UTF-8 com BOM):
readr::write_excel_csv(df, "portarias.csv")
```

**Colunas de saída:** `portaria`, `data_publicacao_dou`, `anexo`, `n_autorizacao`, `tipo`, `regimento_normativo`, `processo`, `retificado`, `enquadramento_in`, `empreendedor`, `empreendimento`, `projeto`, `arqueologos_coordenadores`, `arqueologos_campo`, `apoio_institucional`, `municipios_abrangencias`, `estados_abrangencias`, `prazo_validade`, `data_expiracao`, `link_portaria_dou`, `quantidade_retificado_dou`, `ultimo_link_retificado_dou`, `link_revogado_dou`, `chave_composta`, `portaria_revogada`, `ano`.

**Principais decisões de projeto** (detalhadas nos comentários do script — ler antes de alterar):

- **Encoding:** a página do DOU é UTF-8; a leitura força UTF-8 e `repair_mojibake()` atua apenas como rede de segurança condicional para o padrão "UTF-8 lido como Latin1", preservando acentos em nomes e municípios.
- **Rótulos equivalentes:** os extratos publicados no DOU não são padronizados — numa única edição coexistem mais de vinte formas de nomear o mesmo campo (ex.: "Arqueólogo Coordenador", "Coordenação Geral", "Arqueólogo(a) Coordenador(a)"). O parser mantém listas de rótulos equivalentes por campo.
- **Captura com lookahead:** os valores dos campos usam `(.+?)` delimitado pelos rótulos seguintes, porque valores reais contêm `;` (ex.: empreendedores compostos). Exceção documentada: no `regimento_normativo`, o `;` é terminador da cláusula.
- **Estados ancorados no nome oficial:** a separação municípios/estados da "Área de Abrangência" é ancorada nos 27 nomes oficiais (mais longos primeiro), evitando que municípios homônimos ("Espírito Santo"/RN, "Ceará-Mirim") sejam lidos como estados. Um mapa de siglas UF resolve casos como "Nova Ubiratã-MT".
- **Deduplicação:** `chave_composta` (= portaria + "_" + processo) + `bind_rows`/`distinct` no acúmulo, coerente com o índice único do banco.
- **Expiração:** `data_expiracao` = data de publicação + prazo autorizativo (interpreta "12 (doze) meses" e variações sem parênteses).
- **Robustez de rede:** User-Agent, timeout e novas tentativas na leitura da página.

## Banco de dados (Supabase)

```sql
CREATE TABLE portarias_iphan (
    id SERIAL PRIMARY KEY,
    Portaria TEXT,
    Data_Publicacao_DOU TEXT,
    Anexo TEXT,
    N_Autorizacao TEXT,
    Tipo TEXT,
    Regimento_Normativo TEXT,
    Processo TEXT,
    Retificado TEXT,
    Enquadramento_IN TEXT,
    Empreendedor TEXT,
    Empreendimento TEXT,
    Projeto TEXT,
    Arqueologos_Coordenadores TEXT,
    Arqueologos_Campo TEXT,
    Apoio_Institucional TEXT,
    Municipios_Abrangencias TEXT,
    Estados_Abrangencias TEXT,
    Prazo_Validade TEXT,
    Data_Expiracao TEXT,
    Link_Portaria_DOU TEXT,
    Quantidade_Retificado_DOU TEXT,
    Ultimo_Link_Retificado_DOU TEXT,
    Link_Revogado_DOU TEXT,
    Chave_composta TEXT UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_portarias_chave_composta
    ON portarias_iphan(Chave_composta);
```

A chave composta única (`portaria + processo`) impede duplicidade de registros entre execuções do script.

## Interface de consulta (Next.js)

Funcionalidades implementadas em `src/app/page.tsx`:

- **Busca textual** que varre as principais colunas (processo, empreendimento, projeto, arqueólogos, apoio institucional, municípios etc.), **insensível a acentuação**;
- **Refinamento por filtros** (ano, tipo, portaria, regimento normativo, autorização retificada e status) com botão de limpar/remover;
- **Seleção de colunas** exibidas — a tela abre com um conjunto padrão e o usuário acrescenta/remove as de interesse;
- **Status calculado no momento da consulta**: `Vigente`, `Vigente Retificado`, `Expirada`, `Revogada` ou `Data não informada`, com código de cores;
- **Trilha de retificações**: cada registro exibe a quantidade de retificações e links numerados ("1ª Retificação", "2ª Retificação"...) para cada publicação no DOU;
- **Revogação vinculada ao registro original**: a autorização revogada exibe o status e o link do ato revogador — não é um lançamento separado;
- **Link para a publicação original** de cada portaria no DOU (rastreabilidade);
- **Paginação** e **exportação em CSV** respeitando as colunas selecionadas;
- Contador de registros e data da última atualização;
- Link de acesso ao **módulo histórico** (dados anteriores a 06/11/2025).

## Operação

A coleta é **semiautomática**: a cada publicação do DOU (terças e sextas-feiras), o operador fornece ao script o link da edição; o script extrai todas as autorizações (em média 24 por edição, distribuídas em anexos de permissão/autorização/renovação) e insere no Supabase via API.

**Retificações e revogações** não seguem padrão textual no DOU que permita extração automática confiável. Atualmente, os status `Vigente Retificado` e `Revogada` são atualizados manualmente via SQL Editor do Supabase, com os respectivos links. A captura automática desses atos está no roadmap.

## Rodando localmente

Pré-requisitos: Node.js 18+ e um projeto Supabase com a tabela acima.

```bash
git clone https://github.com/machadotm/consulta-portarias.git
cd consulta-portarias
npm install
```

Crie um arquivo `.env.local` na raiz:

```
NEXT_PUBLIC_SUPABASE_URL=https://SEU_PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=SUA_CHAVE_ANON
```

```bash
npm run dev
# http://localhost:3000
```

Para o script R: R 4.x com os pacotes `rvest`, `httr`, `dplyr`, `stringr`, `purrr`, `tibble`, `readr`.

## Limitações conhecidas e roadmap

- [ ] Captura automática de retificações e revogações (hoje manual, por ausência de padrão textual na fonte);
- [ ] Gatilho de `updated_at` no banco para trilha temporal de alterações;
- [ ] Institucionalização em domínio próprio do IPHAN, com abertura ao público externo (superintendências, consultorias, arqueólogos);
- [ ] A padronização dos extratos na origem tende a ser resolvida com o futuro SAIP 2.0 (Sistema de Avaliação do Impacto ao Patrimônio Cultural).

## Contexto normativo

- [Instrução Normativa IPHAN nº 6/2025](https://www.in.gov.br/web/dou/-/instrucao-normativa-iphan-n-6-de-28-de-novembro-de-2025-672013509) — §1º do Art. 46 (comprovação de exequibilidade)
- [Ofício nº 58/2018/CNA/DEPAM-IPHAN](https://www.gov.br/iphan/pt-br/patrimonio-cultural/patrimonio-arqueologico/Ofcio_58_diretrizes_emissao_portarias_cna.pdf/@@display-file/file) — diretrizes para emissão de portarias

## Créditos

Desenvolvido pela equipe da CGLic/IPHAN. Iniciativa inscrita no 30º Concurso Inovação no Setor Público (Enap, 2026).