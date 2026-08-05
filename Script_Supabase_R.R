# ============================================================================
# supabase_portarias.R
# ----------------------------------------------------------------------------
# Envio de portarias (dataframe R) para uma tabela no Supabase via API REST.
#
# Este arquivo unifica, numa única função pública `enviar_portarias()`, o que
# antes eram várias funções soltas (checagem do .env, conexão REST, conversão
# de datas, busca de chaves existentes, upsert/insert e verificação). As antigas
# funções auxiliares viraram sub-funções internas de escopo local — não poluem
# mais o ambiente global e não podem ser chamadas fora de ordem.
#
# ---------------------------------------------------------------------------
# CORREÇÃO PRINCIPAL — DUPLICATAS INTERNAS ("sequence gap")
# ---------------------------------------------------------------------------
# Sintoma: o envio falhava quando o próprio dataframe trazia 2+ linhas com a
# mesma `unique_col` (mesma chave_composta). Com constraint UNIQUE na tabela, o
# INSERT do lote inteiro é abortado pelo Postgres (uma linha nova conflita com
# outra linha nova do mesmo POST), e o serial do `id` é consumido mesmo com a
# falha — daí os "gaps" na sequência. Antes, era preciso remover a duplicata na
# mão.
#
# Agora a função DE-DUPLICA o dataframe em memória antes de enviar, mantendo a
# PRIMEIRA ocorrência de cada chave (via !duplicated) e relatando quais chaves
# tinham duplicata. A verificação contra o que já existe no Supabase continua
# existindo; a novidade é resolver também a duplicidade DENTRO do lote.
#
# ---------------------------------------------------------------------------
# USO
#   source("supabase_portarias.R")
#
#   # Passo 0 (uma única vez): criar o arquivo .env com o modelo de variáveis.
#   # Depois, abra o .env e preencha as chaves reais do Supabase.
#   # ATENÇÃO: rode SÓ na 1ª vez — chamar de novo SOBRESCREVE o .env, apagando
#   # as chaves que você já tiver preenchido.
#   create_env_file()
#
#   # Envio padrão (ignora duplicados já existentes + de-duplica o lote):
#   enviar_portarias(df, unique_col = "chave_composta")
#
#   # Modo merge (atualiza registros existentes em vez de ignorá-los):
#   enviar_portarias(df, unique_col = "chave_composta", ignore_duplicates = FALSE)
#
#   # Só conferir a configuração do .env:
#   enviar_portarias(checar_config = TRUE)
#
#   # Só verificar a contagem atual na tabela:
#   enviar_portarias(verificar = TRUE)
#
# PARÂMETROS
#   df                dataframe a enviar (uma linha por registro)
#   table_name        tabela no Supabase (default "portarias_iphan")
#   unique_col        coluna UNIQUE/PK usada para detectar duplicados
#                     (para este projeto: "chave_composta")
#   schema            schema no Postgres (default "public")
#   ignore_duplicates TRUE  -> ignora chaves já existentes (INSERT dos novos)
#                     FALSE -> merge/upsert (atualiza os existentes)
#   use_service_role  TRUE usa a SERVICE_ROLE key; FALSE usa a ANON key
#   checar_config     TRUE apenas valida o .env e retorna (não envia)
#   verificar         TRUE apenas consulta a contagem da tabela e retorna
#   dedupe_report     "chaves" (mostra as chaves duplicadas), "contagem" (só o
#                     número) ou "nenhum" (silencioso). Default "chaves".
#
# RETORNO (envio): lista invisível com
#   enviados, ignorados_existentes, duplicados_internos, total_original, status
#
# DEPENDÊNCIAS: httr, jsonlite, dotenv
# ============================================================================

suppressWarnings(suppressMessages({
  if (!requireNamespace("httr", quietly = TRUE))     stop("Pacote 'httr' é necessário.")
  if (!requireNamespace("jsonlite", quietly = TRUE)) stop("Pacote 'jsonlite' é necessário.")
  if (!requireNamespace("dotenv", quietly = TRUE))   stop("Pacote 'dotenv' é necessário (para load_dot_env).")
}))

# ============================================================================
# create_env_file() — cria um .env MODELO (sem segredos reais) no diretório
# de trabalho, para você preencher com as chaves do Supabase.
#
# ATENÇÃO: sobrescreve o .env existente. Rode SÓ na primeira configuração;
# depois preencha as chaves e não rode de novo (senão perde o que preencheu).
# Por isso NÃO há chamada automática aqui — execute manualmente quando quiser.
# Nunca versione o .env (adicione-o ao .gitignore).
# ============================================================================
create_env_file <- function() {
  env_content <- '
# ================================
# SUPABASE
# ================================
SUPABASE_URL=INFORMAR_AQUI_URL_DO_BANCO
# chave pública (para leitura no site, com RLS)
SUPABASE_ANON_KEY=INFORMAR_AQUI_CHAVE_ANON_KEY
# chave secreta (SOMENTE para scripts privados / servidor)
SUPABASE_SERVICE_ROLE_KEY=INFORMAR_AQUI_SERVICE_ROLE_KEY
# ================================
# OPCIONAL
# ================================
PROJECT_NAME=INFORMAR_AQUI_NOME_DO_BANCO
ENVIRONMENT=development
'
  
  if (file.exists(".env")) {
    cat("⚠️ Já existe um .env neste diretório:", normalizePath(".env"), "\n")
    cat("   Para evitar apagar chaves já preenchidas, este comando NÃO vai\n")
    cat("   sobrescrever. Apague/renomeie o .env atual se quiser recriar o modelo.\n")
    return(invisible(FALSE))
  }
  
  writeLines(trimws(env_content), ".env")
  cat("✅ Arquivo .env criado com sucesso!\n")
  cat("📁 Local: ", normalizePath(getwd()), "/.env\n", sep = "")
  cat("⚠️ IMPORTANTE: preencha as chaves e nunca suba esse arquivo no GitHub.\n")
  invisible(TRUE)
}

enviar_portarias <- function(
    df= df_portarias,
    table_name = "portarias_iphan",
    unique_col = "chave_composta",
    schema = "public",
    ignore_duplicates = TRUE,
    use_service_role = TRUE,
    checar_config = FALSE,
    verificar = FALSE,
    dedupe_report = c("chaves", "contagem", "nenhum")
) {
  
  dedupe_report <- match.arg(dedupe_report)
  
  # ------------------------------------------------------------------
  # (1) Carrega .env e valida a configuração mínima.
  # Retorna TRUE/FALSE. Não aborta o R; quem chama decide o que fazer.
  # ------------------------------------------------------------------
  checar_env <- function() {
    if (!file.exists(".env")) {
      cat("❌ Arquivo .env NÃO encontrado!\n")
      cat("📁 Diretório atual:", getwd(), "\n")
      return(FALSE)
    }
    
    dotenv::load_dot_env()
    
    required_vars <- c("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    missing_vars <- required_vars[Sys.getenv(required_vars) == ""]
    
    if (length(missing_vars) > 0) {
      cat("❌ Variáveis faltando no .env:\n")
      cat(paste(" -", missing_vars, collapse = "\n"), "\n")
      return(FALSE)
    }
    
    cat("✅ .env carregado e configuração mínima OK.\n")
    cat("🌐 URL configurada.\n")
    cat("🔐 SERVICE_ROLE configurada (não exibida).\n")
    if (Sys.getenv("SUPABASE_ANON_KEY") == "") {
      cat("⚠️ ANON key não configurada (ok se você só escreve pelo R).\n")
    } else {
      cat("🔓 ANON key configurada (não exibida).\n")
    }
    TRUE
  }
  
  # ------------------------------------------------------------------
  # (2) Monta url + key a partir do .env. Aborta se faltar algo.
  # ------------------------------------------------------------------
  conectar <- function() {
    dotenv::load_dot_env()
    supabase_url <- Sys.getenv("SUPABASE_URL")
    supabase_key <- if (use_service_role) {
      Sys.getenv("SUPABASE_SERVICE_ROLE_KEY")
    } else {
      Sys.getenv("SUPABASE_ANON_KEY")
    }
    if (supabase_url == "" || supabase_key == "") {
      stop("Configure SUPABASE_URL e a chave correspondente no .env")
    }
    list(url = supabase_url, key = supabase_key)
  }
  
  # Cabeçalhos padrão reutilizados nas requisições.
  headers_padrao <- function(config, extra = c()) {
    do.call(httr::add_headers, c(
      list(
        "apikey" = config$key,
        "Authorization" = paste("Bearer", config$key)
      ),
      extra
    ))
  }
  
  # ------------------------------------------------------------------
  # (3) Converte colunas POSIXct/POSIXt para ISO 8601 UTC (texto).
  # ------------------------------------------------------------------
  converter_datas <- function(dados) {
    for (col in names(dados)) {
      x <- dados[[col]]
      if (inherits(x, "POSIXct") || inherits(x, "POSIXt")) {
        dados[[col]] <- format(as.POSIXct(x, tz = "UTC"), "%Y-%m-%dT%H:%M:%SZ")
      }
    }
    dados
  }
  
  # ------------------------------------------------------------------
  # (4) Busca as chaves já existentes na tabela (coluna unique_col).
  # Pagina a leitura para não perder chaves quando a tabela é grande
  # (o PostgREST limita o número de linhas por resposta).
  # ------------------------------------------------------------------
  buscar_chaves_existentes <- function(config) {
    chaves <- character(0)
    passo <- 1000
    inicio <- 0
    
    repeat {
      url <- paste0(config$url, "/rest/v1/", table_name, "?select=", unique_col)
      resp <- httr::GET(
        url = url,
        headers_padrao(config),
        httr::add_headers("Range-Unit" = "items",
                          "Range" = paste0(inicio, "-", inicio + passo - 1))
      )
      code <- httr::status_code(resp)
      if (!(code >= 200 && code < 300)) {
        stop(paste0(
          "Erro ao buscar chaves existentes. Código: ", code,
          "\nMensagem: ", httr::content(resp, "text", encoding = "UTF-8")
        ))
      }
      
      texto <- httr::content(resp, "text", encoding = "UTF-8")
      dados <- jsonlite::fromJSON(texto, simplifyVector = TRUE)
      
      if (is.data.frame(dados) && nrow(dados) > 0 && unique_col %in% names(dados)) {
        chaves <- c(chaves, as.character(dados[[unique_col]]))
        if (nrow(dados) < passo) break   # última página
        inicio <- inicio + passo
      } else {
        break                            # tabela vazia ou fim
      }
    }
    unique(chaves)
  }
  
  # ------------------------------------------------------------------
  # (5) POST de um dataframe já preparado. Retorna a resposta httr.
  # ------------------------------------------------------------------
  post_dados <- function(config, dados, prefer, query = "") {
    payload <- jsonlite::toJSON(
      dados, dataframe = "rows", na = "null", auto_unbox = TRUE
    )
    httr::POST(
      url = paste0(config$url, "/rest/v1/", table_name, query),
      headers_padrao(config, list(
        "Content-Type" = "application/json",
        "Prefer" = prefer
      )),
      body = payload
    )
  }
  
  # ==================================================================
  # ATALHOS: checagem de config e verificação de contagem
  # ==================================================================
  if (checar_config) {
    return(invisible(checar_env()))
  }
  
  if (verificar) {
    config <- conectar()
    resp <- httr::GET(
      url = paste0(config$url, "/rest/v1/", table_name, "?select=count"),
      headers_padrao(config)
    )
    if (httr::status_code(resp) == 200) {
      parsed <- httr::content(resp, "parsed")
      total <- tryCatch(parsed[[1]]$count, error = function(e) NA)
      cat("📊 Total de registros na tabela Supabase:", total, "\n")
      return(invisible(total))
    } else {
      cat("❌ Não foi possível verificar a contagem. Código:",
          httr::status_code(resp), "\n")
      return(invisible(NULL))
    }
  }
  
  # ==================================================================
  # FLUXO DE ENVIO
  # ==================================================================
  if (missing(df)) {
    stop("Informe o dataframe 'df' a enviar (ou use checar_config=TRUE / verificar=TRUE).")
  }
  if (missing(unique_col) || is.null(unique_col) || unique_col == "") {
    stop("Você precisa informar unique_col (coluna UNIQUE/PK no Supabase).")
  }
  if (!(unique_col %in% names(df))) {
    stop(paste0("A coluna '", unique_col, "' não existe no df."))
  }
  if (nrow(df) == 0) {
    cat("⚠️ Dataframe vazio. Nada a enviar.\n")
    return(invisible(NULL))
  }
  
  # Coluna única sempre como caractere (comparação consistente).
  df[[unique_col]] <- as.character(df[[unique_col]])
  
  total_original <- nrow(df)
  
  # ---------------------------------------------------------------
  # (A) DE-DUPLICAÇÃO INTERNA — a correção do "sequence gap".
  # Mantém a PRIMEIRA ocorrência de cada chave dentro do próprio df.
  # ---------------------------------------------------------------
  is_dup_interno <- duplicated(df[[unique_col]])
  duplicados_internos <- sum(is_dup_interno)
  
  if (duplicados_internos > 0) {
    chaves_dup <- unique(df[[unique_col]][is_dup_interno])
    if (dedupe_report == "chaves") {
      cat("🧹 Duplicatas internas removidas (mantida a 1ª ocorrência):",
          duplicados_internos, "\n")
      cat("   Chaves afetadas (", length(chaves_dup), "):\n", sep = "")
      cat(paste0("   - ", chaves_dup, collapse = "\n"), "\n")
    } else if (dedupe_report == "contagem") {
      cat("🧹 Duplicatas internas removidas (mantida a 1ª ocorrência):",
          duplicados_internos, "\n")
    }
    df <- df[!is_dup_interno, , drop = FALSE]
  }
  
  # ---------------------------------------------------------------
  # (B) MODO MERGE (ignore_duplicates = FALSE): upsert de tudo.
  # ---------------------------------------------------------------
  if (!ignore_duplicates) {
    config <- conectar()
    df <- converter_datas(df)
    
    resp <- post_dados(
      config, df,
      prefer = "resolution=merge-duplicates,return=minimal",
      query = paste0("?on_conflict=", unique_col)
    )
    code <- httr::status_code(resp)
    
    if (code >= 200 && code < 300) {
      cat("✅ UPSERT (merge) concluído com sucesso!\n")
      cat("📌 Tabela:", table_name, "| 🧷 Coluna:", unique_col, "\n")
      cat("📊 Registros processados (incluindo atualizações):", nrow(df), "\n")
    } else {
      cat("❌ Erro no UPSERT:\n")
      cat("Código:", code, "\n")
      cat("Mensagem:", httr::content(resp, "text", encoding = "UTF-8"), "\n")
    }
    
    return(invisible(list(
      enviados = if (code >= 200 && code < 300) nrow(df) else 0,
      ignorados_existentes = 0,
      duplicados_internos = duplicados_internos,
      total_original = total_original,
      status = code
    )))
  }
  
  # ---------------------------------------------------------------
  # (C) MODO IGNORE (ignore_duplicates = TRUE): filtra o que já existe
  # e insere só os novos.
  # ---------------------------------------------------------------
  cat("🔍 Verificando duplicados no Supabase pela coluna '", unique_col, "'...\n", sep = "")
  
  config <- conectar()
  
  existing_keys <- tryCatch(
    buscar_chaves_existentes(config),
    error = function(e) {
      cat("❌ Erro ao consultar chaves existentes:\n", e$message, "\n")
      cat("🛑 Operação abortada.\n")
      NULL
    }
  )
  if (is.null(existing_keys)) {
    return(invisible(NULL))
  }
  
  ja_existe <- df[[unique_col]] %in% existing_keys
  df_novos <- df[!ja_existe, , drop = FALSE]
  n_novos <- nrow(df_novos)
  n_ignorados <- sum(ja_existe)
  
  cat("📊 Total no dataframe (original):", total_original, "\n")
  if (duplicados_internos > 0) {
    cat("🧹 Duplicatas internas removidas:", duplicados_internos, "\n")
  }
  cat("🆕 Novos (serão enviados):", n_novos, "\n")
  cat("🔁 Já existentes no Supabase (ignorados):", n_ignorados, "\n")
  
  if (n_novos == 0) {
    cat("✅ Nenhum novo registro para enviar.\n")
    return(invisible(list(
      enviados = 0,
      ignorados_existentes = n_ignorados,
      duplicados_internos = duplicados_internos,
      total_original = total_original,
      status = NA_integer_
    )))
  }
  
  df_novos <- converter_datas(df_novos)
  
  resp <- post_dados(config, df_novos, prefer = "return=minimal")
  code <- httr::status_code(resp)
  
  if (code >= 200 && code < 300) {
    cat("✅ ", n_novos, " novo(s) registro(s) enviado(s) com sucesso!\n", sep = "")
    cat("📌 Tabela:", table_name, "| 🧷 Coluna:", unique_col, "\n")
    cat("🔁 Ignorados (já existiam):", n_ignorados,
        "| 🧹 Duplicatas internas:", duplicados_internos, "\n")
  } else {
    cat("❌ Erro ao enviar novos registros:\n")
    cat("Código:", code, "\n")
    cat("Mensagem:", httr::content(resp, "text", encoding = "UTF-8"), "\n")
  }
  
  invisible(list(
    enviados = if (code >= 200 && code < 300) n_novos else 0,
    ignorados_existentes = n_ignorados,
    duplicados_internos = duplicados_internos,
    total_original = total_original,
    status = code
  ))
}

# ============================================================================
# Enviar para o Supabase
# ----------------------------------------------------------------------------

enviar_portarias(
  df = df_portarias,
  table_name = "portarias_iphan",
  unique_col = "chave_composta",
  schema = "public",
  ignore_duplicates = TRUE)
