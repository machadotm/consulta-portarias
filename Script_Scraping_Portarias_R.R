# Instalação de bibliotecas
library(rvest)
library(xml2)
library(httr)
library(stringr)
library(dplyr)
library(purrr)
library(tibble)
library(lubridate)

# `%||%` vem de rlang/purrr; se não estiver disponível, defina o fallback abaixo.
if (!exists("%||%")) `%||%` <- function(a, b) if (is.null(a) || length(a) == 0) b else a
# ============================================================================

scrape_portarias <- function(links,
                             projeto_col = "Projeto", # mantido por compat.; não é usado
                             accumulate_var = "df_portarias_acumulado",
                             verbose = FALSE) {
  
  # Log condicional: só imprime se verbose = TRUE (visível a todas as
  # sub-funções por escopo léxico).
  vcat <- function(...) if (isTRUE(verbose)) cat(...)
  
  UA <- paste0("Mozilla/5.0 (compatible; R-scraper/1.0; +https://www.in.gov.br)")
  
  #----------------------- ENCODING -----------------------
  
  # Detecta o mojibake típico de "UTF-8 lido como Latin1" (Ã/Â seguidos de
  # bytes altos). Só assim aplicamos o reparo, para não estragar texto correto.
  has_mojibake <- function(x) {
    !is.na(x) & str_detect(x, "\u00C3[\u0080-\u00BF]|\u00C2[\u00A0-\u00BF]")
  }
  
  # Correção CORRETA de mojibake: re-encoda em latin1 (recupera os bytes UTF-8
  # originais) e reinterpreta como UTF-8. Só roda quando há mojibake.
  repair_mojibake <- function(text) {
    if (is.na(text)) return(NA_character_)
    if (!has_mojibake(text)) return(text)
    fixed <- suppressWarnings(iconv(text, from = "UTF-8", to = "latin1"))
    if (is.na(fixed)) return(text)               # caractere fora do latin1: mantém original
    Encoding(fixed) <- "UTF-8"
    if (validUTF8(fixed)) fixed else text        # só aceita se o resultado for UTF-8 válido
  }
  
  #----------------------- LEITURA ROBUSTA DA PÁGINA -----------------------
  
  # Baixa a página forçando UTF-8, com User-Agent, timeout e algumas tentativas.
  read_dou_page <- function(url, tries = 3L) {
    last_err <- NULL
    for (k in seq_len(tries)) {
      resp <- tryCatch(
        GET(url, user_agent(UA), timeout(30)),
        error = function(e) { last_err <<- e; NULL }
      )
      if (!is.null(resp) && status_code(resp) == 200L) {
        txt <- content(resp, as = "text", encoding = "UTF-8")  # <- encoding correto na origem
        return(read_html(txt, encoding = "UTF-8"))
      }
      Sys.sleep(1.5 * k)  # backoff simples + educado com o servidor
    }
    stop("Falha ao baixar: ", url,
         if (!is.null(last_err)) paste0(" (", conditionMessage(last_err), ")") else "")
  }
  
  #----------------------- FUNÇÕES AUXILIARES -----------------------
  
  clean_text <- function(x) {
    x %>% str_replace_all("\\s+", " ") %>% str_trim()
  }
  
  # Padroniza processo no formato xxxxx.xxxxxx/xxxx-xx
  padronizar_processo <- function(proc_str) {
    if (is.na(proc_str)) {
      vcat("  Processo: NA (nada para padronizar)\n")
      return(NA_character_)
    }
    vcat("  Processo original para padronização:", proc_str, "\n")
    
    proc_clean <- str_remove_all(proc_str, "[^0-9./-]")
    vcat("  Processo limpo:", proc_clean, "\n")
    
    padrao_correto <- "^[0-9]{5}\\.[0-9]{6}/[0-9]{4}-[0-9]{2}$"
    if (str_detect(proc_clean, padrao_correto)) {
      vcat("  Processo já está no formato correto\n")
      return(proc_clean)
    }
    
    numeros <- str_extract_all(proc_clean, "[0-9]+")[[1]]
    vcat("  Números extraídos:", paste(numeros, collapse = ", "), "\n")
    
    if (length(numeros) >= 4) {
      parte1 <- str_pad(numeros[1], width = 5, pad = "0")
      parte2 <- str_pad(numeros[2], width = 6, pad = "0")
      parte3 <- str_pad(numeros[3], width = 4, pad = "0")
      parte4 <- str_pad(numeros[4], width = 2, pad = "0")
      processo_padronizado <- paste0(parte1, ".", parte2, "/", parte3, "-", parte4)
      vcat("  Processo padronizado:", processo_padronizado, "\n")
      if (str_detect(processo_padronizado, padrao_correto)) {
        vcat("  Processo padronizado com SUCESSO\n")
        return(processo_padronizado)
      }
    }
    vcat("  Processo NÃO padronizado, retornando original limpo\n")
    proc_clean
  }
  
  # Extrai processo de parágrafos específicos
  extrair_processo <- function(lines) {
    processo <- NA_character_
    vcat("  Buscando processo nos parágrafos específicos...\n")
    
    padroes <- c(
      "^Processo\\s+n[º°\\.]?\\s*[:\\s]*([^\\n]+)",
      "^PROCESSO\\s+N[º°\\.]?\\s*[:\\s]*([^\\n]+)",
      "^Processo\\s+Iphan\\s+n[º°\\.]?\\s*[:\\s]*([^\\n]+)",
      "^Processo\\s+IPHAN\\s+n[º°\\.]?\\s*[:\\s]*([^\\n]+)",
      "^PROCESSO\\s+IPHAN\\s+N[º°\\.]?\\s*[:\\s]*([^\\n]+)",
      "^Processo:\\s*([^\\n]+)",
      "^PROCESSO:\\s*([^\\n]+)",
      "^\\d{2}\\s*-\\s*Processo\\s+n[º°\\.]?\\s*[:\\s]*([^\\n]+)",
      "^\\d{2}\\s*-\\s*PROCESSO\\s+N[º°\\.]?\\s*[:\\s]*([^\\n]+)"
    )
    
    for (i in seq_along(padroes)) {
      padrao <- padroes[i]
      vcat("  Tentando padrão", i, ":", padrao, "\n")
      linha_processo <- lines[str_detect(lines, regex(padrao, ignore_case = TRUE))]
      if (length(linha_processo) > 0) {
        vcat("  Linha encontrada com padrão", i, ":", linha_processo[1], "\n")
        match <- str_match(linha_processo[1], regex(padrao, ignore_case = TRUE))
        if (!is.na(match[1, 2])) {
          texto_processo <- match[1, 2] %>% str_squish()
          vcat("  Texto do processo extraído:", texto_processo, "\n")
          texto_processo <- str_split(texto_processo, "\\s+-\\s+|\\s+–\\s+|\\s*[,;]\\s*")[[1]][1]
          vcat("  Texto do processo limpo:", texto_processo, "\n")
          processo <- texto_processo
          break
        }
      }
    }
    
    if (!is.na(processo) && processo != "") {
      vcat("  Processo encontrado, iniciando padronização...\n")
      processo <- padronizar_processo(processo)
    } else {
      vcat("  Nenhum processo encontrado nos parágrafos específicos\n")
    }
    processo
  }
  
  # Extrai data dd/mm/aaaa de "Publicado em: ... |"
  extract_dou_date <- function(header_lines) {
    pub_line <- header_lines %>%
      keep(~ str_detect(.x, regex("^Publicado em:", ignore_case = TRUE))) %>%
      first()
    if (is.na(pub_line)) return(NA_character_)
    dt <- str_match(pub_line, "Publicado em:\\s*([0-9]{2}/[0-9]{2}/[0-9]{4})")[, 2]
    dt %||% NA_character_
  }
  
  # Extrai a Portaria do título da página
  extract_portaria <- function(page, all_text_lines = NULL) {
    title_text <- NA_character_
    try({
      title_text <- page %>% html_element("title") %>% html_text2() %>% str_squish()
    }, silent = TRUE)
    
    pattern_full <- regex(
      "(?i)\\bPortaria\\b[^\\d\\n\\r]{0,30}?(?:N\\p{Punct}?\\s*)?(\\d{1,3})\\s*,\\s*de\\s*\\d{1,2}\\s+de\\s+[A-Za-zà-úÀ-Ú]+\\s+de\\s*(\\d{4})",
      dotall = TRUE
    )
    m <- str_match(title_text, pattern_full)
    if (!is.na(m[1])) return(paste0("Portaria nº ", as.integer(m[2]), "/", m[3]))
    
    if (!is.null(all_text_lines)) {
      big <- paste(all_text_lines, collapse = " ")
      m2 <- str_match(big, pattern_full)
      if (!is.na(m2[1])) return(paste0("Portaria nº ", as.integer(m2[2]), "/", m2[3]))
    }
    
    pattern_loose <- regex("(?i)\\bPortaria\\b[^\\d\\n\\r]{0,30}?(?:N\\p{Punct}?\\s*)?(\\d{1,3}).*?(\\d{4})", dotall = TRUE)
    m3 <- str_match(ifelse(is.na(title_text), "", title_text), pattern_loose)
    if (!is.na(m3[1])) return(paste0("Portaria nº ", as.integer(m3[2]), "/", m3[3]))
    if (!is.null(all_text_lines)) {
      big <- paste(all_text_lines, collapse = " ")
      m4 <- str_match(big, pattern_loose)
      if (!is.na(m4[1])) return(paste0("Portaria nº ", as.integer(m4[2]), "/", m4[3]))
    }
    NA_character_
  }
  
  slice_header <- function(lines) {
    start_idx <- which(str_detect(lines, regex("^Diário Oficial da União", ignore_case = TRUE)))[1]
    end_idx   <- which(str_detect(lines, regex("^(O\\s+Diretor|A\\s+Diretora|O\\s+Diretora|A\\s+Diretor)\\b", ignore_case = TRUE)))[1]
    if (is.na(start_idx)) start_idx <- 1
    if (is.na(end_idx))   end_idx   <- min(length(lines), start_idx + 50)
    lines[start_idx:end_idx]
  }
  
  extract_annex_items <- function(annex_lines) {
    starts <- which(str_detect(annex_lines, "^\\d{2}\\s*-\\s*"))
    if (length(starts) == 0) return(list())
    end_pattern <- regex("\\b(mes|mês|meses|ano|anos)\\b\\.?\\s*\\)?\\s*$", ignore_case = TRUE)
    ends <- which(str_detect(annex_lines, end_pattern))
    
    items <- list()
    for (s in starts) {
      e <- ends[which(ends >= s)][1]
      if (is.na(e)) e <- min(s + 20, length(annex_lines))
      items[[length(items) + 1]] <- annex_lines[s:e]
    }
    items
  }
  
  # Extrai campos de um item
  parse_item_fields <- function(item_lines) {
    vcat("\n=== INICIANDO PARSE_ITEM_FIELDS ===\n")
    
    # Texto já vem em UTF-8 correto (corrigido na leitura). Aplica repair só por
    # segurança, condicionalmente, item a item.
    lines <- item_lines %>%
      map_chr(~ repair_mojibake(str_squish(.x))) %>%
      keep(~ nchar(.x) > 0)
    full <- paste(lines, collapse = " ")
    
    vcat("Número de linhas do item:", length(lines), "\n")
    if (isTRUE(verbose)) for (i in seq_along(lines)) vcat("Linha", i, ":", lines[i], "\n")
    
    # PROCESSO
    vcat("=== EXTRAÇÃO DO PROCESSO ===\n")
    proc_val <- extrair_processo(lines)
    
    if (is.na(proc_val)) {
      proc_pattern <- "([0-9]{5}\\.[0-9]{6}/[0-9]{4}-[0-9]{2})"
      if (str_detect(full, proc_pattern)) {
        proc_val <- str_match(full, proc_pattern)[, 2]
        vcat("  Processo encontrado com padrão completo:", proc_val, "\n")
      }
    }
    
    if (is.na(proc_val)) {
      for (ln in lines) {
        if (str_detect(ln, regex("Processo\\s+n\\.?\\s*º|\\d{2}-\\s*Processo", ignore_case = TRUE))) {
          m <- str_match(ln, "([0-9]{5}\\.[0-9]{6}/[0-9]{4}-[0-9]{2})")[, 2]
          if (!is.na(m)) { proc_val <- m; break }
          alt <- str_match(ln, regex("Processo\\s+n\\.?\\s*º?\\s*[:\\s]*([0-9\\.\\/\\-]+)", ignore_case = TRUE))[, 2]
          if (!is.na(alt) && str_detect(alt, "\\d")) {
            proc_val <- padronizar_processo(alt)
            if (!is.na(proc_val)) break
          }
        }
      }
    }
    vcat("  PROCESSO FINAL:", proc_val, "\n\n")
    
    # N_Autorizacao
    n_aut <- NA_character_
    for (ln in lines) {
      if (str_detect(ln, "^\\d{2}\\s*-\\s*")) {
        n_aut <- str_match(ln, "^(\\d{2})\\s*-\\s*")[, 2]; break
      }
    }
    
    # Arqueólogos
    coord_val <- NA_character_
    campo_val <- NA_character_
    matched_raw <- character(0)
    
    # Rótulos dos arqueólogos: mantenha UMA variante por linha (só o texto
    # antes dos dois-pontos). O 'rabo' comum é aplicado de uma vez via paste0.
    aut_tail <- ":\\s*([^.\"]+)\\.?"
    
    coord_labels <- c(
      "[Cc]oordenador[a] [Gg]eral",
      "[Aa]rque[óo]logo[s] [Cc]oordenador",
      "Arqueólogo Coordenador",
      "Arqueólogo Coordenador ",
      "[Aa]rque[óo]logo\\(a\\) [Cc]oordenador\\(a\\)",
      "Arqueólogo Coordenação geral",
      "[Cc]oordenação [Gg]eral",
      "Arqueóloga Coordenador geral e de campo",
      "Arqueóloga Coordenadora",
      "Arqueólogos Coordenares",
      "Arqueólogo Coordenador Geral e Campo",
      "Arqueólogo Coordenador Geral e Coordenador de Campo",
      "[Aa]rque[óo]logo[s] [Cc]oordenadora",
      "[Aa]rque[óo]loga[s] [Cc]oordenadora",
      "[Aa]rque[óo]log[ao] [Cc]oordenadora",
      "[Aa]rque[óo]logo [Cc]oordenador [Gg]eral",
      "[Aa]rque[óo]logos [Cc]oordenadores [Gg]eral",
      "[Aa]rque[óo]logos [Cc]oordenadores [Gg]erais",
      "[Aa]rque[óo]loga [Cc]oordenadora [Gg]eral",
      "[Aa]rque[óo]logas [Cc]oordenadoras [Gg]eral",
      "[Aa]rque[óo]logas [Cc]oordenadoras [Gg]erais",
      "[Aa]rque[óo]logo [Cc]oordenador e de [Cc]ampo",
      "[Aa]rque[óo]loga [Cc]oordenadora e de [Cc]ampo",
      "[Aa]rque[óo]logos [Cc]oordenadores",
      "[Aa]rque[óo]logas [Cc]oordenadoras",
      "[Cc]oordena[çc][ãa]o [Gg]eral",
      "[Aa]rque[óo]logos [Cc]oordenadores e de [Cc]ampo",
      "[Aa]rque[óo]logas [Cc]oordenadoras e de [Cc]ampo",
      "[Aa]rque[óo]logo [Cc]oordenador [Gg]eral e de [Cc]ampo",
      "[Aa]rque[óo]loga [Cc]oordenadora [Gg]eral e de [Cc]ampo",
      "[Aa]rque[óo]logos [Cc]oordenadores [Gg]eral e de [Cc]ampo",
      "[Aa]rque[óo]logas [Cc]oordenadoras [Gg]eral e de [Cc]ampo"
    )
    coord_patterns <- paste0(coord_labels, aut_tail)
    
    campo_labels <- c(
      "[Cc]oordenadora de [Cc]ampo",
      "[Cc]oordenadoras de [Cc]ampo",
      "[Cc]oordenador de [Cc]ampo",
      "[Cc]oordenadores de [Cc]ampo",
      "[Aa]rque[óo]logo de [Cc]ampo",
      "[Aa]rque[óo]loga de [Cc]ampo",
      "[Aa]rque[óo]logos de [Cc]ampo",
      "[Aa]rque[óo]logas de [Cc]ampo",
      "[Aa]rque[óo]logo[s] [Cc]oordenador de [Cc]ampo",
      "Arqueólogo Coordenador de Campo",
      "Arqueólogo Coordenação de campo",
      "[Cc]oordenação de [Cc]ampo",
      "Arqueólogos Coodenadores de Campo",
      "Arqueólogo Coordenador Geral e Campo",
      "Arqueólogo Coordenador Geral e Coordenador de Campo",
      "[Aa]rque[óo]logo(?:\\(a\\))? [Cc]oordenador(?:\\(a\\))? de [Cc]ampo",
      "[Aa]rque[óo]logo(?:\\(a\\))? de [Cc]ampo",
      "[Aa]rque[óo]logo [Cc]oordenadora de [Cc]ampo",
      "[Aa]rque[óo]logos [Cc]oordenador de [Cc]ampo",
      "[Aa]rque[óo]loga[s] [Cc]oordenadora de [Cc]ampo",
      "[Aa]rque[óo]loga [Cc]oordenador de [Cc]ampo",
      "[Aa]rque[óo]logos [Cc]oordenadores de [Cc]ampo",
      "[Aa]rque[óo]logas [Cc]oordenadoras de [Cc]ampo",
      "[Aa]rque[óo]logo [Cc]oordenador e de [Cc]ampo",
      "[Aa]rque[óo]logo [Cc]oordenador [Gg]eral e de [Cc]ampo",
      "[Aa]rque[óo]loga [Cc]oordenador [Gg]eral e de [Cc]ampo",
      "[Aa]rque[óo]loga [Cc]oordenadora [Gg]eral e de [Cc]ampo",
      "[Aa]rque[óo]loga [Cc]oordenadora e de [Cc]ampo",
      "[Aa]rque[óo]logos [Cc]oordenadores e de [Cc]ampo",
      "[Aa]rque[óo]logas [Cc]oordenadoras e de [Cc]ampo",
      "[Aa]rque[óo]loga [Cc]oordena[çc][ãa]o de [Cc]ampo",
      "[Aa]rque[óo]loga [Cc]oordena[çc][ãa]o de campo",
      "[Aa]rque[óo]logo [Cc]oordena[çc][ãa]o de [Cc]ampo",
      "[Cc]oordena[çc][ãa]o de [Cc]ampo",
      "[Aa]rque[óo]logo [Cc]oordena[çc][ãa]o de campo",
      "[Aa]rque[óo]logo [Cc]oordenador [Gg]eral e de [Cc]ampo",
      "[Aa]rque[óo]loga [Cc]oordenadora [Gg]eral e de [Cc]ampo",
      "[Aa]rque[óo]logos [Cc]oordenadores [Gg]eral e de [Cc]ampo",
      "[Aa]rque[óo]logas [Cc]oordenadoras [Gg]eral e de [Cc]ampo"
    )
    campo_patterns <- paste0(campo_labels, aut_tail)
    
    for (i in seq_along(lines)) {
      ln <- lines[i]
      for (pattern in coord_patterns) {
        if (str_detect(ln, regex(pattern, ignore_case = TRUE))) {
          m <- str_match(ln, regex(pattern, ignore_case = TRUE))
          if (!is.na(m[1])) {
            value <- str_squish(m[, 2])
            if (!is.na(value) && value != "") {
              coord_val <- ifelse(is.na(coord_val), value, paste(coord_val, value, sep = "; "))
              matched_raw <- c(matched_raw, ln); break
            }
          }
        }
      }
      for (pattern in campo_patterns) {
        if (str_detect(ln, regex(pattern, ignore_case = TRUE))) {
          m <- str_match(ln, regex(pattern, ignore_case = TRUE))
          if (!is.na(m[1])) {
            value <- str_squish(m[, 2])
            if (!is.na(value) && value != "") {
              campo_val <- ifelse(is.na(campo_val), value, paste(campo_val, value, sep = "; "))
              matched_raw <- c(matched_raw, ln); break
            }
          }
        }
      }
    }
    
    cleaned_lines <- lines
    if (length(matched_raw) > 0) cleaned_lines <- cleaned_lines[!cleaned_lines %in% matched_raw]
    cleaned <- paste(cleaned_lines, collapse = " ")
    
    # Enquadramento
    enqu_raw <- str_match(cleaned, regex("(?:Enquadramento\\s+IN|Enquadramento):\\s*([^;]+?)(?=\\s+(?:Empreendedor|Responsável pelo empreendimento):|\\s+Empreendimento:|\\s+Projeto:|\\s+(?:Apoio|Endosso)\\s+Institucional:|\\s+Área\\s+de\\s+Abrangência:|\\s+Prazo\\s+de\\s+Validade:|$)", ignore_case = TRUE))[, 2]
    enqu <- if (!is.na(enqu_raw)) str_remove(enqu_raw, regex("\\s+\\bProcesso\\b\\s+n?\\.?\\s*º?:?.*$", ignore_case = TRUE)) %>% str_squish() else NA_character_
    
    if (!is.na(enqu)) {
      padrao_remover_enqu <- regex("(?:Enquadramento\\s+IN|Enquadramento):\\s*([^;]+?)(?=\\s+(?:Empreendedor|Responsável pelo empreendimento):|\\s+Empreendimento:|\\s+Projeto:|\\s+(?:Apoio|Endosso)\\s+Institucional:|\\s+Área\\s+de\\s+Abrangência:|\\s+Prazo\\s+de\\s+Validade:|$)", ignore_case = TRUE)
      cleaned <- str_remove(cleaned, padrao_remover_enqu) %>% str_squish()
    }
    
    empr <- str_match(cleaned, regex("(?:Empreendedor|Responsável pelo empreendimento):\\s*([^;]+?)(?=\\s+Empreendimento:|\\s+Processo|\\s+Projeto:|\\s+(?:Apoio|Endosso)\\s+Institucional:|\\s+Área\\s+de\\s+Abrangência:|\\s+Prazo\\s+de\\s+Validade:|$)", ignore_case = TRUE))[, 2]
    if (!is.na(empr)) {
      padrao_remover_empr <- regex("(?:Empreendedor|Responsável pelo empreendimento):\\s*[^;]+?(?=\\s+Empreendimento:|\\s+Processo|\\s+Projeto:|\\s+(?:Apoio|Endosso)\\s+Institucional:|\\s+Área\\s+de\\s+Abrangência:|\\s+Prazo\\s+de\\s+Validade:|$)", ignore_case = TRUE)
      cleaned <- str_remove(cleaned, padrao_remover_empr) %>% str_squish()
    }
    
    empd  <- str_match(cleaned, regex("Empreendimento:\\s*([^;]+?)(?=\\s+(?:Responsável pelo empreendimento):|\\s+Processo|\\s+Projeto:|\\s+(?:Apoio|Endosso)\\s+Institucional:|\\s+Área\\s+de\\s+Abrangência:|\\s+Prazo\\s+de\\s+Validade:|$)", ignore_case = TRUE))[, 2]
    apoio <- str_match(cleaned, regex("(?:Apoio|Endosso)\\s+Institucional:\\s*([^;]+?)(?=\\s+Área\\s+de\\s+Abrangência:|\\s+Prazo\\s+de\\s+Validade:|$)", ignore_case = TRUE))[, 2]
    
    area <- NA_character_
    area_patterns <- c(
      "Área\\s+de\\s+Abrangência\\s*:\\s*(.+?)(?=\\s+Prazo\\s+de\\s+Validade:|$)",
      "Área\\s+de\\s+Abrangência\\s*:\\s*(.+)",
      "Área\\s+Abrangência\\s*:\\s*(.+)",
      "Area\\s+de\\s+Abrangencia\\s*:\\s*(.+)"
    )
    for (pattern in area_patterns) {
      area_match <- str_match(cleaned, regex(pattern, ignore_case = TRUE, dotall = TRUE))
      if (!is.na(area_match[1])) { area <- area_match[, 2]; break }
    }
    if (is.na(area)) {
      for (pattern in area_patterns) {
        area_match <- str_match(full, regex(pattern, ignore_case = TRUE, dotall = TRUE))
        if (!is.na(area_match[1])) { area <- area_match[, 2]; break }
      }
    }
    
    prazo <- NA_character_
    prazo_patterns <- c(
      "Prazo\\s+de\\s+Validade\\s*:\\s*([^;]+)$",
      "Prazo\\s+da\\s+Validade\\s*:\\s*([^;]+)$",
      "Prazo\\s+da\\s+portaria\\s*:\\s*([^;]+)$",
      "Prazo\\s+Validade\\s*:\\s*([^;]+)$"
    )
    for (pattern in prazo_patterns) {
      match <- str_match(cleaned, regex(pattern, ignore_case = TRUE))
      if (!is.na(match[1])) { prazo <- str_squish(match[2]); break }
    }
    
    proj <- NA_character_
    if (str_detect(cleaned, regex("Projeto:\\s*", ignore_case = TRUE))) {
      proj <- str_match(cleaned, regex("Projeto:\\s*([^;]+?)(?=\\s+(?:Responsável pelo empreendimento):|\\s+(?:Apoio|Endosso)\\s+Institucional:|\\s+Área\\s+de\\s+Abrangência:|\\s+Prazo\\s+de\\s+Validade:|$)", ignore_case = TRUE))[, 2]
    }
    
    tibble(
      N_Autorizacao             = n_aut     %||% NA_character_,
      Processo                  = proc_val  %||% NA_character_,
      Enquadramento_IN          = enqu      %||% NA_character_,
      Empreendedor              = empr      %||% NA_character_,
      Empreendimento            = empd      %||% NA_character_,
      Projeto                   = proj      %||% NA_character_,
      Arqueologos_Coordenadores = coord_val %||% NA_character_,
      Arqueologos_Campo         = campo_val %||% NA_character_,
      Apoio_Institucional       = apoio     %||% NA_character_,
      Area_Abrangencia_raw      = area      %||% NA_character_,
      Prazo_Validade            = prazo     %||% NA_character_
    )
  }
  
  # Separa municípios e estados a partir de "Área de Abrangência"
  split_area <- function(area_str) {
    if (is.na(area_str)) return(tibble(Municipios_Abrangencias = NA_character_, Estados_Abrangencias = NA_character_))
    
    s <- clean_text(repair_mojibake(area_str))
    
    estados_brasileiros <- c("Mato Grosso do Sul", "Acre", "Alagoas", "Amapá", "Amazonas", "Bahia", "Ceará",
                             "Distrito Federal", "Espírito Santo", "Goiás", "Maranhão",
                             "Mato Grosso", "Minas Gerais", "Pará", "Paraíba", "Paraná",
                             "Pernambuco", "Piauí", "Rio de Janeiro",
                             "Rio Grande do Norte", "Rio Grande do Sul", "Rondônia",
                             "Roraima", "Santa Catarina", "São Paulo", "Sergipe", "Tocantins")
    
    area_content <- NA_character_
    area_patterns <- c(
      "(?i)Área\\s+de\\s+Abrangência\\s*:\\s*(.+)",
      "(?i)Área\\s+Abrangência\\s*:\\s*(.+)",
      "(?i)Area\\s+de\\s+Abrangencia\\s*:\\s*(.+)"
    )
    for (pattern in area_patterns) {
      match <- str_match(s, regex(pattern, dotall = TRUE))
      if (!is.na(match[1])) { area_content <- match[, 2]; break }
    }
    if (is.na(area_content)) area_content <- s
    
    # 1. Estados na ordem correta
    estados_ordenados <- character(0)
    texto_trabalho <- area_content
    padroes_estado <- c(
      "no Estado do\\s+([^,;.|]+(?:\\s+[^,;.|]+)*)", "no Estado de\\s+([^,;.|]+(?:\\s+[^,;.|]+)*)", "no Estado da\\s+([^,;.|]+(?:\\s+[^,;.|]+)*)",
      "nos Estados do\\s+([^,;.|]+(?:\\s+[^,;.|]+)*)", "nos Estados de\\s+([^,;.|]+(?:\\s+[^,;.|]+)*)", "nos Estados da\\s+([^,;.|]+(?:\\s+[^,;.|]+)*)",
      "Estado do\\s+([^,;.|]+(?:\\s+[^,;.|]+)*)", "Estado de\\s+([^,;.|]+(?:\\s+[^,;.|]+)*)", "Estado da\\s+([^,;.|]+(?:\\s+[^,;.|]+)*)",
      "estado do\\s+([^,;.|]+(?:\\s+[^,;.|]+)*)", "estado de\\s+([^,;.|]+(?:\\s+[^,;.|]+)*)", "estado da\\s+([^,;.|]+(?:\\s+[^,;.|]+)*)",
      "Distrito Federal"
    )
    while (nchar(texto_trabalho) > 0) {
      estado_encontrado <- NA_character_
      melhor_match <- ""; melhor_posicao <- Inf
      for (padrao in padroes_estado) {
        regex_padrao <- regex(padrao, ignore_case = TRUE)
        match_pos <- str_locate(texto_trabalho, regex_padrao)
        if (!is.na(match_pos[1]) && match_pos[1] < melhor_posicao) {
          melhor_posicao <- match_pos[1]
          match_texto <- str_match(texto_trabalho, regex_padrao)
          melhor_match <- match_texto[1, 1]
          if (padrao == "Distrito Federal") {
            estado_encontrado <- "Distrito Federal"
          } else {
            estado_limpo <- match_texto[1, 2] %>% str_squish() %>%
              str_replace_all("^(o|a|os|as|no|Estado|estado)\\s+", "") %>% str_squish()
            if (estado_limpo %in% estados_brasileiros) estado_encontrado <- estado_limpo
          }
        }
      }
      if (!is.na(estado_encontrado)) {
        if (!estado_encontrado %in% estados_ordenados) estados_ordenados <- c(estados_ordenados, estado_encontrado)
        texto_trabalho <- str_sub(texto_trabalho, melhor_posicao + nchar(melhor_match))
      } else break
    }
    for (estado in estados_brasileiros) {
      if (str_detect(area_content, regex(paste0("\\b", estado, "\\b"), ignore_case = TRUE)) &&
          !estado %in% estados_ordenados) estados_ordenados <- c(estados_ordenados, estado)
    }
    estados_ordenados <- estados_ordenados[!sapply(estados_ordenados, function(e) {
      any(e != estados_ordenados & str_detect(estados_ordenados, fixed(e)))
    })]
    
    # 2. Municípios
    texto_limpo <- area_content %>%
      str_replace_all("(?i)Prazo\\s+(?:da\\s+)?portaria\\s*:\\s*[^.]+\\.?", "") %>%
      str_replace_all("(?i)Prazo\\s+de\\s+validade\\s*:\\s*[^.]+\\.?", "") %>%
      str_replace_all("(?i)Área\\s+de\\s+Abrangência\\s*:\\s*", "") %>%
      str_squish()
    
    blocos <- texto_limpo %>% str_split("(;|\\|)") %>% unlist() %>%
      map_chr(str_squish) %>% keep(~ nchar(.x) > 0)
    
    todos_municipios <- character(0)
    for (bloco in blocos) {
      bloco_limpo <- bloco
      padroes_prefixo_remover <- c(
        "(?i)no Estado do\\s+[^,;.|]+", "(?i)no Estado de\\s+[^,;.|]+", "(?i)no Estado da\\s+[^,;.|]+",
        "(?i)nos Estados do\\s+[^,;.|]+", "(?i)nos Estados de\\s+[^,;.|]+", "(?i)nos Estados da\\s+[^,;.|]+",
        "(?i)Estado do\\s+[^,;.|]+", "(?i)Estado de\\s+[^,;.|]+", "(?i)Estado da\\s+[^,;.|]+",
        "(?i)estado do\\s+[^,;.|]+", "(?i)estado de\\s+[^,;.|]+", "(?i)estado da\\s+[^,;.|]+",
        "(?i)Município de\\s+", "(?i)Municípios de\\s+", "(?i)município de\\s+", "(?i)municípios de\\s+",
        "Distrito Federal"
      )
      for (padrao in padroes_prefixo_remover) bloco_limpo <- str_remove_all(bloco_limpo, padrao)
      
      bloco_limpo <- bloco_limpo %>%
        str_replace_all("(?i)^municípios?\\s+de\\s+", "") %>%
        str_replace_all("(?i)^município\\s+", "") %>%
        str_replace_all("(?i),\\s*municípios?\\s+de\\s+", ", ") %>%
        str_squish() %>%
        str_replace_all("\\s*-\\s*Estado\\s*", " ") %>%
        str_replace_all("\\s*-\\s*$", "") %>%
        str_squish()
      
      if (nchar(bloco_limpo) > 0) {
        partes <- bloco_limpo %>% str_split(",") %>% unlist() %>%
          map_chr(str_squish) %>% keep(~ nchar(.x) > 0)
        municipios_bloco <- character(0)
        for (parte in partes) {
          if (str_detect(parte, "\\s+e\\s+") && nchar(parte) > 10) {
            subpartes <- str_split(parte, "\\s+e\\s+")[[1]] %>% map_chr(str_squish) %>% keep(~ nchar(.x) > 2)
            for (subparte in subpartes) {
              if (!subparte %in% c("e", "de", "da", "do", "no") && nchar(subparte) > 2)
                municipios_bloco <- c(municipios_bloco, subparte)
            }
          } else {
            if (!parte %in% c("e", "de", "da", "do", "no") && nchar(parte) > 2)
              municipios_bloco <- c(municipios_bloco, parte)
          }
        }
        if (length(municipios_bloco) == 0 && nchar(bloco_limpo) > 3) {
          palavras <- str_split(bloco_limpo, "\\s+")[[1]]
          if (length(palavras) <= 3) {
            if (!bloco_limpo %in% estados_brasileiros ||
                (bloco_limpo %in% estados_brasileiros && str_detect(bloco, "(?i)município")))
              municipios_bloco <- c(municipios_bloco, bloco_limpo)
          }
        }
        todos_municipios <- c(todos_municipios, municipios_bloco)
      }
    }
    
    todos_municipios <- todos_municipios %>% unique() %>% keep(~ nchar(.x) > 2) %>%
      keep(~ !.x %in% c("e", "de", "da", "do", "no") &&
             !str_detect(.x, "^\\s*$") &&
             !str_detect(.x, "Prazo da portaria") &&
             !str_detect(.x, "^\\(.*\\)$"))
    
    if (length(todos_municipios) == 0 && length(estados_ordenados) == 1) {
      match_municipio <- str_match(area_content, "(?i)Município(?:\\s+de)?\\s+([^,.;]+)")
      if (!is.na(match_municipio[1])) {
        municipio_candidato <- match_municipio[1, 2] %>% str_squish()
        if (municipio_candidato %in% estados_brasileiros)
          todos_municipios <- c(todos_municipios, municipio_candidato)
      }
    }
    
    municipios_out <- if (length(todos_municipios) > 0) {
      if (length(todos_municipios) == 1) todos_municipios
      else paste(paste(todos_municipios[1:(length(todos_municipios) - 1)], collapse = ", "),
                 todos_municipios[length(todos_municipios)], sep = " e ")
    } else NA_character_
    
    estados_out <- if (length(estados_ordenados) > 0) paste(estados_ordenados, collapse = ", ") else NA_character_
    
    tibble(Municipios_Abrangencias = municipios_out, Estados_Abrangencias = estados_out)
  }
  
  compute_expiration <- function(pub_date_str, prazo_str) {
    if (is.na(pub_date_str) || is.na(prazo_str)) return(NA_character_)
    dt <- lubridate::dmy(pub_date_str)
    if (is.na(dt)) return(NA_character_)
    m <- str_match(prazo_str, "(\\d{1,3})\\s*\\(([^\\)]*)\\)?\\s*(meses|mês|mes|anos|ano|Meses|Mês|Mes|Anos|Ano)")
    if (is.na(m[1])) m <- str_match(prazo_str, "(\\d{1,3})\\s*(meses|mês|mes|anos|ano|Meses|Mês|Mes|Anos|Ano)")
    if (is.na(m[1])) return(NA_character_)
    qtd <- as.integer(m[2]); unit <- m[ncol(m)]
    exp_date <- switch(tolower(unit),
                       "mês" = dt %m+% months(qtd), "mes" = dt %m+% months(qtd), "meses" = dt %m+% months(qtd),
                       "ano" = dt %m+% years(qtd),  "anos" = dt %m+% years(qtd),  dt)
    format(exp_date, "%d/%m/%Y")
  }
  
  extract_tipo_regime_by_roman <- function(section_line) {
    section_line <- repair_mojibake(section_line)
    tipo <- str_match(section_line, regex("Expedir\\s*([A-ZÇÃÕ]+)", ignore_case = TRUE))[, 2]
    if (is.na(tipo)) tipo <- str_match(section_line, regex("Expedir\\s+([A-Z]+)", ignore_case = TRUE))[, 2]
    
    reg_raw <- str_match(section_line, regex("regidos\\s+pela\\s+([^;]+)(?:;|$)", ignore_case = TRUE))[, 2]
    if (!is.na(reg_raw)) {
      reg <- reg_raw %>%
        str_remove_all(",\\s+de\\s+\\d{1,2}\\s+de\\s+\\w+\\s+de\\s+\\d{4}") %>%
        str_remove(",\\s+conforme\\s+o\\s+caso\\s+aplicável") %>%
        str_replace_all("[;.,]+$", "") %>% str_squish()
    } else reg <- NA_character_
    
    list(Tipo = tipo %||% NA_character_, Regimento_Normativo = reg %||% NA_character_)
  }
  
  #----------------------- SCRAPING DE UMA PORTARIA -----------------------
  
  scrape_portaria_iphan <- function(url) {
    vcat("=== INICIANDO SCRAPING DA PORTARIA ===\nURL:", url, "\n")
    
    page <- read_dou_page(url)   # <- leitura com encoding UTF-8 correto
    
    lines <- page %>% html_elements(xpath = "//*") %>% html_text2() %>%
      keep(~ nchar(.x) > 0) %>%
      map_chr(clean_text) %>%
      map_chr(repair_mojibake)   # rede de segurança (só age se detectar mojibake)
    
    start <- which(str_detect(lines, regex("^Diário Oficial da União", ignore_case = TRUE)))[1]
    end   <- which(str_detect(lines, regex("^REPORTAR ERRO", ignore_case = TRUE)))[1]
    if (is.na(start)) start <- 1
    if (is.na(end))   end   <- length(lines)
    content <- lines[start:end]
    
    header       <- slice_header(content)
    dou_date     <- extract_dou_date(header)
    portaria_fmt <- extract_portaria(page, all_text_lines = content)
    vcat("Data DOU:", dou_date, "| Portaria:", portaria_fmt, "\n")
    
    roman_sections <- content %>%
      keep(~ str_detect(.x, regex("\\b([IVXLCDM]+)\\s*[-–—]\\s*Expedir\\s+", ignore_case = TRUE)))
    
    annex_idx <- which(str_detect(content, regex("^ANEXO\\s+[IVX]+\\b", ignore_case = TRUE)))
    annex_list <- list()
    for (i in seq_along(annex_idx)) {
      a_start <- annex_idx[i]
      a_end   <- if (i < length(annex_idx)) annex_idx[i + 1] - 1 else length(content)
      annex_roman <- str_match(content[a_start], regex("ANEXO\\s+([IVX]+)", ignore_case = TRUE))[, 2]
      annex_items <- extract_annex_items(content[(a_start + 1):a_end])
      annex_list[[i]] <- list(roman = annex_roman, items = annex_items)
    }
    vcat("Número de anexos encontrados:", length(annex_list), "\n")
    
    items_df <- purrr::map_dfr(annex_list, function(ax) {
      if (length(ax$items) == 0) return(tibble())
      purrr::map_dfr(ax$items, function(it) {
        fields <- parse_item_fields(it)
        area_split <- split_area(fields$Area_Abrangencia_raw)
        fields <- bind_cols(fields %>% select(-Area_Abrangencia_raw), area_split)
        fields$Anexo <- ax$roman
        fields
      })
    })
    
    tipo_reg_by_annex <- tibble(Anexo = character(), Tipo = character(), Regimento_Normativo = character())
    for (rs in roman_sections) {
      rn <- str_match(rs, regex("\\b([IVXLCDM]+)\\s*[-–—]"))[, 2]
      tr <- extract_tipo_regime_by_roman(rs)
      tipo_reg_by_annex <- bind_rows(tipo_reg_by_annex,
                                     tibble(Anexo = rn, Tipo = tr$Tipo, Regimento_Normativo = tr$Regimento_Normativo))
    }
    tipo_reg_by_annex <- tipo_reg_by_annex %>% distinct(Anexo, .keep_all = TRUE)
    
    if (nrow(items_df) == 0) return(tibble())
    
    items_df <- items_df %>%
      left_join(tipo_reg_by_annex, by = "Anexo") %>%
      mutate(
        Portaria            = portaria_fmt,
        Data_Publicacao_DOU = dou_date,
        Data_Expiracao      = map_chr(Prazo_Validade, ~ compute_expiration(dou_date, .x)),
        Chave_composta      = paste(Portaria, Processo, sep = "_"),
        Link_Portaria_DOU   = url,
        Retificado          = "Não"
      )
    
    final_cols <- c(
      "Portaria", "Data_Publicacao_DOU", "Anexo", "N_Autorizacao", "Tipo", "Regimento_Normativo", "Processo",
      "Retificado", "Enquadramento_IN", "Empreendedor", "Empreendimento", "Projeto", "Arqueologos_Coordenadores",
      "Arqueologos_Campo", "Apoio_Institucional", "Municipios_Abrangencias", "Estados_Abrangencias",
      "Prazo_Validade", "Data_Expiracao", "Link_Portaria_DOU", "Quantidade_Retificado_DOU",
      "Ultimo_Link_Retificado_DOU", "Link_Revogado_DOU", "Chave_composta"
    )
    for (cl in final_cols) if (!cl %in% names(items_df)) items_df[[cl]] <- NA_character_
    items_df <- items_df %>% select(all_of(final_cols))
    
    vcat("Total de itens extraídos:", nrow(items_df), "\n")
    items_df
  }
  
  #----------------------- ACUMULAÇÃO E EXECUÇÃO -----------------------
  
  empty_df <- function() {
    tibble(
      Portaria = character(), Data_Publicacao_DOU = character(), Anexo = character(),
      N_Autorizacao = character(), Tipo = character(), Regimento_Normativo = character(),
      Processo = character(), Retificado = character(), Enquadramento_IN = character(),
      Empreendedor = character(), Empreendimento = character(), Projeto = character(),
      Arqueologos_Coordenadores = character(), Arqueologos_Campo = character(),
      Apoio_Institucional = character(), Municipios_Abrangencias = character(),
      Estados_Abrangencias = character(), Prazo_Validade = character(),
      Data_Expiracao = character(), Link_Portaria_DOU = character(),
      Quantidade_Retificado_DOU = character(), Ultimo_Link_Retificado_DOU = character(),
      Link_Revogado_DOU = character(), Chave_composta = character()
    )
  }
  
  existing_df <- if (exists(accumulate_var, envir = .GlobalEnv)) {
    vcat("Carregando dados existentes de:", accumulate_var, "\n")
    get(accumulate_var, envir = .GlobalEnv)
  } else {
    vcat("Criando novo dataframe:", accumulate_var, "\n")
    NULL
  }
  
  dfs <- map(links, safely(scrape_portaria_iphan))
  # Loga erros por link, em vez de silenciá-los
  walk2(links, dfs, function(u, r) {
    if (!is.null(r$error)) warning("Falha em ", u, ": ", conditionMessage(r$error), call. = FALSE)
  })
  out <- map(dfs, ~ .x$result) %>% compact()
  
  if (length(out) == 0) return(existing_df %||% empty_df())
  
  result_df <- bind_rows(out)
  
  # Rede de segurança final: só corrige células que ainda apresentem mojibake.
  result_df <- result_df %>%
    mutate(across(where(is.character), ~ map_chr(., repair_mojibake)))
  
  if (!is.null(existing_df)) {
    result_df <- bind_rows(existing_df, result_df) %>% distinct()
  }
  
  assign(accumulate_var, result_df, envir = .GlobalEnv)
  vcat("Total de registros no dataframe:", nrow(result_df), "\n")
  result_df
}

# ============================================================================
# EXEMPLO DE USO
# ----------------------------------------------------------------------------
links <- c("https://www.in.gov.br/web/dou/-/portaria-n-63-de-6-de-julho-de-2026-717182605")

df_portarias <- scrape_portarias(links, verbose = TRUE) # verbose para depurar

# Adicionando a coluna Portaria Revogada e Ano
df_portarias <- df_portarias %>% 
  mutate(Portaria_Revogada= NA,
         Ano = substr(Data_Publicacao_DOU, 7, 10))

# Converter TODAS as colunas do DataFrame para minúsculas
names(df_portarias) <- tolower(names(df_portarias))

# Verificar os dados
cat("📋 Resumo dos dados:\n")
cat("Número de registros:", nrow(df_portarias), "\n")
cat("Colunas:", paste(names(df_portarias), collapse = ", "), "\n")

# 3. Verificar chaves únicas
cat("🔑 Verificando chaves compostas:\n")
chaves_unicas <- unique(df_portarias$chave_composta)
cat("Chaves únicas encontradas:", length(chaves_unicas), "\n")
cat("Número de registros:", nrow(df_portarias), "\n")

# Verificar quais valores estão duplicados na coluna
valores_duplicados <- df_portarias %>%
  count(chave_composta) %>%
  filter(n > 1) %>%
  pull(chave_composta)

cat("Valores duplicados na coluna chave_composta",":\n")
print(valores_duplicados)

#Verificar quantidade de endossos emitidos
endossos <- df_portarias %>%
  filter(!is.na(apoio_institucional ))

cat("Quantidade de endossos na portaria",":\n")
count(endossos)

# Enviar para o Supabase
cat("☁️ Enviando dados para o Supabase...\n")

upsert_to_supabase(
  df = df_portarias,
  table_name = "portarias_iphan",
  unique_col = "chave_composta",
  ignore_duplicates = TRUE)
