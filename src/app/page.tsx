'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

// Configuração do Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Nome da chave primária da tabela
const PRIMARY_KEY = 'id'

// Lista de todas as colunas disponíveis
const todasColunas = [
  { id: 'ano', nome: 'Ano' },
  { id: 'portaria', nome: 'Portaria' },
  { id: 'data_publicacao_dou', nome: 'Data de Publicação no DOU' },
  { id: 'anexo', nome: 'Anexo' },
  { id: 'n_autorizacao', nome: 'Nº da Autorização' },
  { id: 'tipo', nome: 'Tipo' },
  { id: 'regimento_normativo', nome: 'Regimento Normativo' },
  { id: 'retificado', nome: 'Autorização Retificada?' },
  { id: 'processo', nome: 'Processo' },
  { id: 'enquadramento_in', nome: 'Enquadramento IN' },
  { id: 'empreendedor', nome: 'Empreendedor' },
  { id: 'empreendimento', nome: 'Empreendimento' },
  { id: 'projeto', nome: 'Projeto' },
  { id: 'arqueologos_coordenadores', nome: 'Arqueólogos Coordenadores' },
  { id: 'arqueologos_campo', nome: 'Arqueólogos de Campo' },
  { id: 'apoio_institucional', nome: 'Apoio Institucional' },
  { id: 'municipios_abrangencias', nome: 'Municípios' },
  { id: 'estados_abrangencias', nome: 'Estados' },
  { id: 'prazo_validade', nome: 'Prazo de Validade' },
  { id: 'data_expiracao', nome: 'Data de Expiração' },
  { id: 'link_portaria_dou', nome: 'Link da Portaria no DOU' },
  { id: 'quantidade_retificado_dou', nome: 'Quantidade de Retificações no DOU' },
  { id: 'ultimo_link_retificado_dou', nome: 'Link de Retificações no DOU' },
  { id: 'portaria_revogada', nome: 'Portaria Revogada' },
  { id: 'link_revogado_dou', nome: 'Link da Revogação no DOU' },
]

// COLUNAS HOME
const colunasHome = [
  'portaria',
  'data_publicacao_dou',
  'tipo',
  'regimento_normativo',
  'processo',
  'arqueologos_coordenadores',
  'arqueologos_campo',
  'prazo_validade',
  'data_expiracao',
  'link_portaria_dou',
  'status_portaria'
]

// Função para remover acentos e caracteres especiais
const normalizarTexto = (texto: string): string => {
  if (!texto) return ''
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

// Comparador NUMÉRICO para valores de "Portaria" ("Portaria nº N/AAAA").
// Ordena do mais recente para o mais antigo: ano decrescente e, dentro do mesmo
// ano, número decrescente (23, 22 ... 2, 1), em vez da ordem alfabética padrão.
// Valores fora do padrão caem para o fim, ordenados alfabeticamente entre si.
const compararPortarias = (a: string, b: string): number => {
  const parse = (s: string) => {
    const m = String(s).match(/(\d+)\s*\/\s*(\d{4})/)
    return m ? { num: parseInt(m[1], 10), ano: parseInt(m[2], 10) } : null
  }
  const pa = parse(a)
  const pb = parse(b)
  if (pa && pb) {
    if (pa.ano !== pb.ano) return pb.ano - pa.ano
    return pb.num - pa.num
  }
  if (pa) return -1
  if (pb) return 1
  return a.localeCompare(b, 'pt-BR')
}

// ---------- BUSCA POR ASPAS (correspondência exata de palavra) ----------
// Escapa caracteres especiais de regex para uso literal no padrão.
const escaparRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Detecta se o termo inteiro está entre aspas (retas " ou tipográficas “ ” « »
// e apóstrofos) e devolve o conteúdo interno; caso contrário, retorna null.
// Ex.: '"lucia"' -> 'lucia' ; 'lucia' -> null
const extrairTermoExato = (termo: string): string | null => {
  const t = termo.trim()
  const m = t.match(/^["“”«»'‘’]([\s\S]+)["“”«»'‘’]$/)
  return m ? m[1].trim() : null
}

// Componente para renderizar links clicáveis
const RenderizarLink = ({ url, texto }: { url: string, texto: string }) => {
  if (!url || !url.startsWith('http')) {
    return <span className="text-gray-500">N/A</span>
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:text-blue-800 underline transition-colors"
      onClick={(e) => e.stopPropagation()}
    >
      {texto || 'Abrir link'}
    </a>
  )
}

// 🔒 FUNÇÃO SEGURA: Exportar para CSV
const exportarParaCSV = (dados: any[], colunasSelecionadas: string[], todasColunas: any[], nomeArquivo: string = `portarias_iphan_${new Date().toISOString().split('T')[0]}.csv`) => {
  if (dados.length === 0) {
    alert('Não há dados para exportar.')
    return
  }

  const colunasOrdenadas: string[] = [];
  if (colunasSelecionadas.includes('status_portaria')) {
    colunasOrdenadas.push('status_portaria');
  }
  todasColunas.forEach(coluna => {
    if (colunasSelecionadas.includes(coluna.id) && coluna.id !== 'status_portaria') {
      colunasOrdenadas.push(coluna.id);
    }
  });

  const headers = colunasOrdenadas.map(colunaId => {
    if (colunaId === 'status_portaria') return 'Status'
    const coluna = todasColunas.find(c => c.id === colunaId)
    return coluna ? coluna.nome : colunaId
  })

  const linhas = dados.map(portaria => {
    return colunasOrdenadas.map(colunaId => {
      if (colunaId === 'status_portaria') {
        if (portaria.tipo &&
            normalizarTexto(portaria.tipo).includes('revogacao') &&
            portaria.link_revogado_dou &&
            portaria.link_revogado_dou.trim() !== '') {
          return 'Revogada'
        }
        const dataExpiracao = portaria.data_expiracao
        if (!dataExpiracao || dataExpiracao.trim() === '') return 'Data não informada'
        const regexData = /^(\d{2})\/(\d{2})\/(\d{4})$/
        const match = dataExpiracao.match(regexData)
        if (!match) return 'Formato inválido'
        const dia = parseInt(match[1])
        const mes = parseInt(match[2]) - 1
        const ano = parseInt(match[3])
        const dataExp = new Date(ano, mes, dia)
        const hoje = new Date()
        hoje.setHours(0, 0, 0, 0)
        const vigente = dataExp > hoje
        if (
          vigente &&
          Number(portaria.quantidade_retificado_dou) > 0 &&
          portaria.ultimo_link_retificado_dou &&
          portaria.ultimo_link_retificado_dou.trim() !== ''
        ) {
          return 'Vigente Retificado'
        }
        return vigente ? 'Vigente' : 'Expirada'
      }
      return `"${(portaria[colunaId] || 'N/A').toString().replace(/"/g, '""')}"`
    }).join(',')
  })

  const csvContent = [headers.join(','), ...linhas].join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.setAttribute('href', url)
  link.setAttribute('download', nomeArquivo)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// -------------------- Componente MultiSelectDropdown (com botão Aplicar/Remover) --------------------
interface MultiSelectDropdownProps {
  label: string
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
  onApply?: () => void
  onRemove?: () => void
  isApplied?: boolean
  placeholder?: string
}

const MultiSelectDropdown = ({
  label,
  options,
  selected,
  onChange,
  onApply,
  onRemove,
  isApplied = false,
  placeholder = 'Selecione...'
}: MultiSelectDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleOption = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  const toggleAll = () => {
    if (selected.length === options.length) {
      onChange([])
    } else {
      onChange([...options])
    }
  }

  const isAllSelected = options.length > 0 && selected.length === options.length
  const isSomeSelected = selected.length > 0 && selected.length < options.length

  const handleApply = () => {
    if (onApply) {
      onApply()
      setIsOpen(false)
    }
  }

  const handleRemove = () => {
    if (onRemove) {
      onRemove()
      setIsOpen(false)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-left flex justify-between items-center focus:ring-2 focus:ring-blue-500 focus:border-transparent hover:bg-gray-50 transition-colors"
      >
        <span className="truncate text-gray-800">
          {selected.length === 0 ? placeholder : `${selected.length} selecionado${selected.length > 1 ? 's' : ''}`}
        </span>
        <svg className={`w-4 h-4 text-gray-600 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-1 w-full max-h-60 overflow-auto bg-white border border-gray-300 rounded-md shadow-lg">
          <div className="sticky top-0 p-2 border-b border-gray-200 bg-gray-50 z-10">
            <div className="flex items-center justify-between">
              <label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded transition-colors">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  ref={(input) => {
                    if (input) input.indeterminate = isSomeSelected
                  }}
                  onChange={toggleAll}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700">Selecionar todos</span>
              </label>
              {onApply && onRemove && (
                <button
                  onClick={() => {
                    if (isApplied) {
                      handleRemove()
                    } else {
                      handleApply()
                    }
                  }}
                  className={`px-3 py-1 text-sm rounded transition-colors ${
                    isApplied
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isApplied ? 'Remover' : 'Aplicar'}
                </button>
              )}
            </div>
          </div>

          {options.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-500 text-center">Nenhuma opção disponível</div>
          ) : (
            <div className="py-1">
              {options.map(option => (
                <label
                  key={option}
                  className={`flex items-center space-x-2 px-3 py-2 cursor-pointer transition-colors ${
                    selected.includes(option)
                      ? 'bg-blue-50 hover:bg-blue-100'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={() => toggleOption(option)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className={`text-sm ${selected.includes(option) ? 'font-semibold text-blue-700' : 'text-gray-800'}`}>
                    {option}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// -------------------- Função para buscar todos os dados paginados --------------------
const buscarTodosDados = async (): Promise<any[]> => {
  const chunkSize = 1000
  let start = 0
  let todosDados: any[] = []

  try {
    while (true) {
      const { data, error } = await supabase
        .from('portarias_iphan')
        .select('*')
        .order(PRIMARY_KEY, { ascending: true })
        .range(start, start + chunkSize - 1)

      if (error) {
        console.error('Erro ao buscar dados:', error)
        break
      }

      if (!data || data.length === 0) break

      todosDados = todosDados.concat(data)
      start += data.length

      if (data.length < chunkSize) break
    }

    return todosDados
  } catch (err) {
    console.error('Erro na busca paginada:', err)
    return []
  }
}

// -------------------- Componente principal --------------------
export default function ConsultaPortarias() {
  const [portarias, setPortarias] = useState<any[]>([])
  const [todosRegistros, setTodosRegistros] = useState<any[]>([])
  const [dadosFiltrados, setDadosFiltrados] = useState<any[]>([])
  const [dadosExibicao, setDadosExibicao] = useState<any[]>([])
  const [termoBuscaInput, setTermoBuscaInput] = useState('')
  const [buscaAplicada, setBuscaAplicada] = useState('')
  const [colunasSelecionadas, setColunasSelecionadas] = useState(colunasHome)
  const [carregando, setCarregando] = useState(true)
  const [dataAtualizacao, setDataAtualizacao] = useState<string>('')
  const [mostrandoTodos, setMostrandoTodos] = useState(false)
  const [modoInicial, setModoInicial] = useState(true)
  const [paginaInput, setPaginaInput] = useState('')

  // Estados: Paginação
  const [paginaAtual, setPaginaAtual] = useState(1)
  const [itensPorPagina] = useState(100)
  const [totalPaginas, setTotalPaginas] = useState(1)
  const [totalRegistros, setTotalRegistros] = useState(0)

  // ---------- ESTADOS DE FILTRO (valores temporários, apenas para UI) ----------
  const [filtroAnosTemp, setFiltroAnosTemp] = useState<string[]>([])
  const [filtroPortariasTemp, setFiltroPortariasTemp] = useState<string[]>([])
  const [filtroTiposTemp, setFiltroTiposTemp] = useState<string[]>([])
  const [filtroRegimentosTemp, setFiltroRegimentosTemp] = useState<string[]>([])
  const [filtroRetificadosTemp, setFiltroRetificadosTemp] = useState<string[]>([])
  const [filtroStatusTemp, setFiltroStatusTemp] = useState<string[]>([])

  // ---------- ESTADOS DE FILTRO APLICADOS (usados na filtragem) ----------
  const [filtroAnos, setFiltroAnos] = useState<string[]>([])
  const [filtroPortarias, setFiltroPortarias] = useState<string[]>([])
  const [filtroTipos, setFiltroTipos] = useState<string[]>([])
  const [filtroRegimentos, setFiltroRegimentos] = useState<string[]>([])
  const [filtroRetificados, setFiltroRetificados] = useState<string[]>([])
  const [filtroStatusList, setFiltroStatusList] = useState<string[]>([])

  const [isClient, setIsClient] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setIsClient(true)
  }, [])

  // Carrega toda a base do Supabase. Extraído para useCallback e chamado na
  // montagem do componente.
  const carregarDados = useCallback(async () => {
    try {
      setCarregando(true)
      const todos = await buscarTodosDados()
      setPortarias(todos)
      setTodosRegistros(todos)
      setTotalRegistros(todos.length)

      // Renomeado: evita sombrear o state 'dataAtualizacao'
      const { data: atualizacaoRows, error: errorAtualizacao } = await supabase
        .from('portarias_iphan')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)

      if (!errorAtualizacao && atualizacaoRows && atualizacaoRows.length > 0) {
        const dataUTC = new Date(atualizacaoRows[0].updated_at)
        // Só formata se a data for válida; extrai APENAS a data (sem hora) no
        // fuso de São Paulo. Isso remove a hora do cálculo e dispensa o ajuste
        // manual de -3h, que era frágil e podia "voltar um dia" em atualizações
        // feitas na madrugada.
        if (!isNaN(dataUTC.getTime())) {
          const fmt = new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          })
          setDataAtualizacao(fmt.format(dataUTC))
        }
      }
    } catch (err) {
      console.error('Erro ao carregar dados:', err)
    } finally {
      setCarregando(false)
    }
  }, [])

  // Carregar todos os dados na montagem (com spinner de tela cheia)
  useEffect(() => {
    carregarDados()
  }, [carregarDados])

  // Exibição inicial - 5 registros mais recentes com status Vigente
  useEffect(() => {
    if (portarias.length === 0) return

    const registrosVigentes = portarias.filter(portaria => {
      const status = calcularStatus(portaria)
      return status === 'Vigente'
    })

    const registrosRecentes = registrosVigentes
      .slice()
      .sort((a, b) => {
        const [diaA, mesA, anoA] = (a.data_publicacao_dou || '').split('/').map(Number)
        const [diaB, mesB, anoB] = (b.data_publicacao_dou || '').split('/').map(Number)
        const dataA = new Date(anoA || 0, (mesA || 1) - 1, diaA || 1)
        const dataB = new Date(anoB || 0, (mesB || 1) - 1, diaB || 1)
        return dataB.getTime() - dataA.getTime()
      })
      .slice(0, 5)

    setDadosFiltrados(registrosRecentes)
    setDadosExibicao(registrosRecentes)
    setMostrandoTodos(false)
    setPaginaAtual(1)
  }, [portarias])

  // Efeito para paginação quando mostrandoTodos ou busca estiver ativo
  useEffect(() => {
    if (mostrandoTodos || buscaAplicada) {
      const total = Math.ceil(dadosFiltrados.length / itensPorPagina)
      setTotalPaginas(total)

      const inicio = (paginaAtual - 1) * itensPorPagina
      const fim = inicio + itensPorPagina
      setDadosExibicao(dadosFiltrados.slice(inicio, fim))
    } else {
      setDadosExibicao(dadosFiltrados)
    }
  }, [dadosFiltrados, paginaAtual, itensPorPagina, mostrandoTodos, buscaAplicada])


  // Função para calcular status
  const calcularStatus = (portaria: any) => {
    if (portaria.tipo &&
        normalizarTexto(portaria.tipo).includes('revogacao') &&
        portaria.link_revogado_dou &&
        portaria.link_revogado_dou.trim() !== '') {
      return 'Revogada'
    }

    const dataExpiracao = portaria.data_expiracao
    if (!dataExpiracao || dataExpiracao.trim() === '') return 'Data não informada'

    const regexData = /^(\d{2})\/(\d{2})\/(\d{4})$/
    const match = dataExpiracao.match(regexData)

    if (!match) return 'Formato inválido'

    const dia = parseInt(match[1])
    const mes = parseInt(match[2]) - 1
    const ano = parseInt(match[3])
    const dataExp = new Date(ano, mes, dia)

    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)

    const vigente = dataExp > hoje

    if (
      vigente &&
      Number(portaria.quantidade_retificado_dou) > 0 &&
      portaria.ultimo_link_retificado_dou &&
      portaria.ultimo_link_retificado_dou.trim() !== ''
    ) {
      return 'Vigente Retificado'
    }

    return vigente ? 'Vigente' : 'Expirada'
  }

  // Busca textual nos dados já carregados.
  // - Sem aspas: busca GLOBAL (parcial, includes) em TODOS os campos — padrão.
  // - Com o termo entre aspas ("lucia"): busca RESTRITA por PALAVRA INTEIRA,
  //   ignorando acento e maiúsc./minúsc., APENAS nas colunas de arqueólogos
  //   (Coordenadores e de Campo). Retorna "lucia"/"lúcia" mas não
  //   "Luciana"/"Luciano". Hífen conta como separador (casa "Lucia-Mirim").
  const aplicarBusca = useCallback((termo: string, dados: any[]) => {
    if (!termo.trim()) return dados

    // Texto de TODOS os campos (usado na busca global, sem aspas).
    const montarTextoGlobal = (portaria: any) =>
      normalizarTexto([
        portaria.portaria,
        portaria.data_publicacao_dou,
        portaria.processo,
        portaria.empreendedor,
        portaria.empreendimento,
        portaria.projeto,
        portaria.arqueologos_coordenadores,
        portaria.arqueologos_campo,
        portaria.apoio_institucional,
        portaria.municipios_abrangencias,
        portaria.estados_abrangencias,
        portaria.tipo,
        portaria.regimento_normativo,
        portaria.enquadramento_in
      ].filter(Boolean).join(' '))

    // Texto SOMENTE das colunas de arqueólogos (usado na busca restrita, aspas).
    const montarTextoArqueologos = (portaria: any) =>
      normalizarTexto([
        portaria.arqueologos_coordenadores,
        portaria.arqueologos_campo
      ].filter(Boolean).join(' '))

    const termoExato = extrairTermoExato(termo)

    // Modo restrito (entre aspas): palavra inteira via \b, só nos arqueólogos.
    if (termoExato !== null) {
      const alvo = normalizarTexto(termoExato)
      if (!alvo) return dados // aspas vazias -> não restringe
      const regexExato = new RegExp(`\\b${escaparRegex(alvo)}\\b`)
      return dados.filter(portaria => regexExato.test(montarTextoArqueologos(portaria)))
    }

    // Modo global (sem aspas): correspondência parcial em todos os campos.
    const termoNormalizado = normalizarTexto(termo)
    return dados.filter(portaria => montarTextoGlobal(portaria).includes(termoNormalizado))
  }, [])

  // Aplicar filtros (usa os estados aplicados)
  const aplicarFiltros = useCallback((dados: any[]) => {
    let resultados = dados

    if (filtroAnos.length > 0) {
      resultados = resultados.filter(portaria => {
        const anoStr = portaria.ano?.toString() || ''
        return filtroAnos.includes(anoStr)
      })
    }

    if (filtroPortarias.length > 0) {
      resultados = resultados.filter(portaria => {
        const valor = portaria.portaria || ''
        const valorNormalizado = normalizarTexto(valor)
        return filtroPortarias.some(filtro => {
          const filtroNormalizado = normalizarTexto(filtro)
          return valorNormalizado.includes(filtroNormalizado)
        })
      })
    }

    if (filtroTipos.length > 0) {
      resultados = resultados.filter(portaria => {
        const valor = portaria.tipo || ''
        const valorNormalizado = normalizarTexto(valor)
        return filtroTipos.some(filtro => {
          const filtroNormalizado = normalizarTexto(filtro)
          return valorNormalizado.includes(filtroNormalizado)
        })
      })
    }

    if (filtroRegimentos.length > 0) {
      resultados = resultados.filter(portaria => {
        const valor = portaria.regimento_normativo || ''
        const valorNormalizado = normalizarTexto(valor)
        return filtroRegimentos.some(filtro => {
          const filtroNormalizado = normalizarTexto(filtro)
          return valorNormalizado.includes(filtroNormalizado)
        })
      })
    }

    if (filtroRetificados.length > 0) {
      resultados = resultados.filter(portaria => {
        const valor = portaria.retificado || ''
        const valorNormalizado = normalizarTexto(valor)
        return filtroRetificados.some(filtro => {
          const filtroNormalizado = normalizarTexto(filtro)
          return valorNormalizado.includes(filtroNormalizado)
        })
      })
    }

    if (filtroStatusList.length > 0) {
      resultados = resultados.filter(portaria => {
        const status = calcularStatus(portaria)
        return filtroStatusList.includes(status)
      })
    }

    return resultados
  }, [filtroAnos, filtroPortarias, filtroTipos, filtroRegimentos, filtroRetificados, filtroStatusList])

  // ============================================================
  // 🔧 EFEITO PRINCIPAL: Atualiza dadosFiltrados com base em todos os estados
  // ============================================================
  useEffect(() => {
    // Caso 1: Modo inicial (sem busca e sem filtros)
    const semBusca = !buscaAplicada
    const semFiltros =
      filtroAnos.length === 0 &&
      filtroPortarias.length === 0 &&
      filtroTipos.length === 0 &&
      filtroRegimentos.length === 0 &&
      filtroRetificados.length === 0 &&
      filtroStatusList.length === 0

    if (semBusca && semFiltros) {
      if (modoInicial && !mostrandoTodos) return

      if (mostrandoTodos) {
        setDadosFiltrados(todosRegistros)
        setTotalPaginas(Math.ceil(todosRegistros.length / itensPorPagina))
        setPaginaAtual(1)
        setModoInicial(false)
        return
      }

      const registrosVigentes = portarias.filter(portaria => {
        const status = calcularStatus(portaria)
        return status === 'Vigente'
      })
      const registrosRecentes = registrosVigentes
        .slice()
        .sort((a, b) => {
          const [diaA, mesA, anoA] = (a.data_publicacao_dou || '').split('/').map(Number)
          const [diaB, mesB, anoB] = (b.data_publicacao_dou || '').split('/').map(Number)
          const dataA = new Date(anoA || 0, (mesA || 1) - 1, diaA || 1)
          const dataB = new Date(anoB || 0, (mesB || 1) - 1, diaB || 1)
          return dataB.getTime() - dataA.getTime()
        })
        .slice(0, 5)
      setDadosFiltrados(registrosRecentes)
      setTotalPaginas(1)
      setPaginaAtual(1)
      setModoInicial(true)
      setMostrandoTodos(false)
      return
    }

    // Caso 2: Modo de consulta (com busca ou filtros)
    setModoInicial(false)
    setMostrandoTodos(true)

    let base = todosRegistros

    if (buscaAplicada.trim()) {
      base = aplicarBusca(buscaAplicada, base)
    }

    const resultados = aplicarFiltros(base)

    setDadosFiltrados(resultados)
    setPaginaAtual(1)
    setTotalPaginas(Math.ceil(resultados.length / itensPorPagina))
  }, [
    buscaAplicada,
    filtroAnos,
    filtroPortarias,
    filtroTipos,
    filtroRegimentos,
    filtroRetificados,
    filtroStatusList,
    todosRegistros,
    portarias,
    itensPorPagina,
    modoInicial,
    mostrandoTodos,
    aplicarBusca,
    aplicarFiltros,
  ])

  // Ações de busca
  const executarBusca = () => {
    setBuscaAplicada(termoBuscaInput)
    setPaginaAtual(1)
  }

  const limparBusca = () => {
    setTermoBuscaInput('')
    setBuscaAplicada('')
    setPaginaAtual(1)
  }

  // onKeyDown (onKeyPress está depreciado no React)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') executarBusca()
  }

  // Ações de filtro
  const aplicarFiltrosHandler = () => {
    // Copia os valores temporários para os aplicados
    setFiltroAnos(filtroAnosTemp)
    setFiltroPortarias(filtroPortariasTemp)
    setFiltroTipos(filtroTiposTemp)
    setFiltroRegimentos(filtroRegimentosTemp)
    setFiltroRetificados(filtroRetificadosTemp)
    setFiltroStatusList(filtroStatusTemp)
  }

  // Funções para remover filtro individual
  const removerFiltroAno = () => {
    setFiltroAnosTemp([])
    setFiltroAnos([])
  }

  const removerFiltroPortaria = () => {
    setFiltroPortariasTemp([])
    setFiltroPortarias([])
  }

  const removerFiltroTipo = () => {
    setFiltroTiposTemp([])
    setFiltroTipos([])
  }

  const removerFiltroRegimento = () => {
    setFiltroRegimentosTemp([])
    setFiltroRegimentos([])
  }

  const removerFiltroRetificado = () => {
    setFiltroRetificadosTemp([])
    setFiltroRetificados([])
  }

  const removerFiltroStatus = () => {
    setFiltroStatusTemp([])
    setFiltroStatusList([])
  }

  const limparTodosFiltros = () => {
    // Limpa os temporários
    setFiltroAnosTemp([])
    setFiltroPortariasTemp([])
    setFiltroTiposTemp([])
    setFiltroRegimentosTemp([])
    setFiltroRetificadosTemp([])
    setFiltroStatusTemp([])
    // Limpa os aplicados
    setFiltroAnos([])
    setFiltroPortarias([])
    setFiltroTipos([])
    setFiltroRegimentos([])
    setFiltroRetificados([])
    setFiltroStatusList([])
  }

  // Carregar mais registros (Ver mais)
  const carregarMaisRegistros = () => {
    setMostrandoTodos(true)
  }

  // Funções auxiliares para obter opções únicas a partir dos dados filtrados (cascata)
  const obterValoresUnicos = useCallback((dados: any[], campo: string, comparador?: (a: string, b: string) => number) => {
    const valoresProcessados = dados
      .map(item => item[campo])
      .map(valor => !valor || valor.toString().trim() === '' ? 'Não informado' : valor.toString().trim())
    const valoresUnicos = [...new Set(valoresProcessados)]
    const naoInformado = valoresUnicos.filter(v => v === 'Não informado')
    const outros = valoresUnicos.filter(v => v !== 'Não informado')
    // Usa o comparador informado (ex.: numérico p/ portarias) ou o sort padrão.
    const ordenados = comparador ? outros.sort(comparador) : outros.sort()
    return [...naoInformado, ...ordenados]
  }, [])

  const obterOpcoesFiltro = useCallback(() => {
    const base = dadosFiltrados.length > 0 ? dadosFiltrados : todosRegistros

    const anos = [...new Set(base.map((item: any) => item.ano).filter((ano: any) => ano != null))]
      .sort((a: number, b: number) => b - a)
      .map(String)

    const portariasFiltro = obterValoresUnicos(base, 'portaria', compararPortarias)
    const tipos = obterValoresUnicos(base, 'tipo')
    const regimentos = obterValoresUnicos(base, 'regimento_normativo')
    const retificados = obterValoresUnicos(base, 'retificado')

    return { anos, portariasFiltro, tipos, regimentos, retificados }
  }, [dadosFiltrados, todosRegistros, obterValoresUnicos])

  const obterOpcoesStatus = useCallback(() => {
    const base = dadosFiltrados.length > 0 ? dadosFiltrados : todosRegistros
    const statusUnicos = [...new Set(base.map(portaria => calcularStatus(portaria)))].sort()
    return statusUnicos
  }, [dadosFiltrados, todosRegistros])

  const { anos, portariasFiltro, tipos, regimentos, retificados } = obterOpcoesFiltro()
  const opcoesStatus = obterOpcoesStatus()

  // Exportação
  const getDadosParaExportar = () => {
    if (buscaAplicada && buscaAplicada.trim() !== '') {
      return {
        dados: dadosFiltrados,
        nome: `portarias_busca_${buscaAplicada.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`
      }
    }
    if (filtroAnos.length > 0 || filtroPortarias.length > 0 || filtroTipos.length > 0 || filtroRegimentos.length > 0 || filtroRetificados.length > 0 || filtroStatusList.length > 0) {
      return {
        dados: dadosFiltrados,
        nome: `portarias_filtradas_${new Date().toISOString().split('T')[0]}.csv`
      }
    }
    if (mostrandoTodos) {
      return {
        dados: todosRegistros,
        nome: `portarias_completas_${new Date().toISOString().split('T')[0]}.csv`
      }
    }
    return {
      dados: todosRegistros,
      nome: `portarias_iphan_${new Date().toISOString().split('T')[0]}.csv`
    }
  }

  const handleExportarCSV = () => {
    const { dados, nome } = getDadosParaExportar()
    exportarParaCSV(dados, colunasSelecionadas, todasColunas, nome)
  }

  // UI: paginação/colunas
  const irParaPagina = (paginaOpcional?: number) => {
    const pagina = paginaOpcional ?? Number(paginaInput)
    if (!pagina || pagina < 1 || pagina > totalPaginas) {
      alert(`Informe uma página entre 1 e ${totalPaginas}`)
      return
    }
    setPaginaAtual(pagina)
  }

  const avancarPagina = () => { if (paginaAtual < totalPaginas) setPaginaAtual(paginaAtual + 1) }
  const voltarPagina = () => { if (paginaAtual > 1) setPaginaAtual(paginaAtual - 1) }

  const alternarColuna = (colunaId: string) => {
    if (colunasSelecionadas.includes(colunaId)) {
      setColunasSelecionadas(colunasSelecionadas.filter(c => c !== colunaId))
    } else {
      setColunasSelecionadas([...colunasSelecionadas, colunaId])
    }
  }

  const renderizarConteudoCelula = (colunaId: string, valor: string) => {
    if (!valor || valor === 'N/A') {
      return <span className="text-gray-500">N/A</span>
    }

    if (colunaId === 'ultimo_link_retificado_dou') {
      const links = valor
        .split(',')
        .map(l => l.trim())
        .filter(l => l.startsWith('http'))

      if (links.length === 0) {
        return <span className="text-gray-500">N/A</span>
      }

      return (
        <div className="flex flex-col gap-1">
          {links.map((link, index) => {
            const numero = String(index + 1).padStart(2, '0')
            return (
              <RenderizarLink
                key={index}
                url={link}
                texto={`${numero}ª Retificação`}
              />
            )
          })}
        </div>
      )
    }

    // 'ultimo_link_retificado_dou' já foi tratado e retornou acima,
    // por isso não aparece mais nesta lista.
    if (
      colunaId === 'link_portaria_dou' ||
      colunaId === 'link_revogado_dou'
    ) {
      if (valor.startsWith('http')) {
        return (
          <RenderizarLink
            url={valor}
            texto={
              colunaId === 'link_portaria_dou'
                ? 'Ver portaria'
                : 'Ver revogação'
            }
          />
        )
      }
    }

    return valor
  }

  const obterClasseStatus = (status: string) => {
    switch (status) {
      case 'Vigente':
        return 'bg-green-100 text-green-800'
      case 'Vigente Retificado':
        return 'bg-blue-100 text-blue-800'
      case 'Expirada':
        return 'bg-red-100 text-red-800'
      case 'Revogada':
        return 'bg-orange-100 text-orange-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const gerarBotoesPagina = () => {
    const botoes = []
    const maxBotoes = 5

    let inicio = Math.max(1, paginaAtual - Math.floor(maxBotoes / 2))
    let fim = Math.min(totalPaginas, inicio + maxBotoes - 1)

    if (fim - inicio + 1 < maxBotoes) {
      inicio = Math.max(1, fim - maxBotoes + 1)
    }

    for (let i = inicio; i <= fim; i++) {
      botoes.push(
        <button
          key={i}
          onClick={() => irParaPagina(i)}
          className={`px-3 py-1 text-sm font-medium rounded-md ${
            paginaAtual === i
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
          }`}
        >
          {i}
        </button>
      )
    }

    return botoes
  }

  const getColunasOrdenadasParaExibicao = () => {
    const colunasOrdenadas: {id: string, nome: string}[] = [];

    if (colunasSelecionadas.includes('status_portaria')) {
      colunasOrdenadas.push({ id: 'status_portaria', nome: 'Status' });
    }

    todasColunas.forEach(coluna => {
      if (colunasSelecionadas.includes(coluna.id) && coluna.id !== 'status_portaria') {
        colunasOrdenadas.push(coluna);
      }
    });

    return colunasOrdenadas;
  }

  // Verificar se há filtros temporários ou aplicados
  const temFiltrosAplicados =
    filtroAnos.length > 0 ||
    filtroPortarias.length > 0 ||
    filtroTipos.length > 0 ||
    filtroRegimentos.length > 0 ||
    filtroRetificados.length > 0 ||
    filtroStatusList.length > 0

  const temFiltrosTemp =
    filtroAnosTemp.length > 0 ||
    filtroPortariasTemp.length > 0 ||
    filtroTiposTemp.length > 0 ||
    filtroRegimentosTemp.length > 0 ||
    filtroRetificadosTemp.length > 0 ||
    filtroStatusTemp.length > 0

  // Retorna true quando o filtro está aplicado E a seleção temporária é idêntica
  // à aplicada (comparação como conjunto, ignora ordem). Usado no botão do
  // dropdown: se for true mostra "Remover"; se o usuário mexeu na seleção
  // (marcou/desmarcou), passa a false e o botão volta para "Aplicar".
  const filtroInalterado = (temp: string[], aplicado: string[]) =>
    aplicado.length > 0 &&
    temp.length === aplicado.length &&
    temp.every(v => aplicado.includes(v))

  if (carregando || !isClient) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Carregando dados...</p>
          <p className="text-sm text-gray-500 mt-2">Isso pode levar alguns segundos</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-4 sm:py-6 lg:py-8 px-2 sm:px-4 lg:px-6">
      <div className="max-w-full mx-auto">

        {/* Cabeçalho */}
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 px-2">
            Consulta de Portarias Autorizativas Extraídas do DOU
          </h1>
          <p className="text-gray-900 text-sm sm:text-base px-2">
            Dados extraídos a partir da Portaria nº 101/2025 - Publicada no DOU em 06/11/2025
          </p>
          <p className="text-gray-900 text-sm sm:text-base px-2">
            Para consultar dados anteriores a 06/11/2025 - {' '}
            <a
              href="https://banco-portarias-cna.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline"
            >
              Ver banco de portarias
            </a>
          </p>
          <p className="text-gray-600 text-sm sm:text-base px-2">
            Busque e filtre as informações de acordo com suas necessidades
          </p>
        </div>

        {/* Barra de Busca */}
        <div className="bg-white rounded-lg shadow p-4 sm:p-6 mb-4 sm:mb-6 mx-2 sm:mx-0">
          <div className="flex flex-col gap-4">
            <div className="flex-1">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  placeholder="🔍 Buscar por nome de arqueólogos, processos, projetos, municípios..."
                  value={termoBuscaInput}
                  onChange={(e) => setTermoBuscaInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                />
                <button
                  onClick={executarBusca}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Buscar
                </button>
                {(termoBuscaInput || buscaAplicada) && (
                  <button
                    onClick={limparBusca}
                    className="px-4 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
                  >
                    Limpar
                  </button>
                )}
              </div>
              <p className="text-sm text-gray-600 mt-2">
                A base de dados consultada possui <span className="font-semibold">{totalRegistros.toLocaleString()}</span> registros
                {buscaAplicada && (
                  <span className="font-semibold">
                    {' '}- Buscando por: "{buscaAplicada}" - encontrado {dadosFiltrados.length} registros
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Dica: Para buscar um nome exato de arqueólogo, utilize aspas — ex.: <span className="font-mono">&quot;lucia&quot;</span> retornará Lucia/Lúcia, mas não incluirá variações como Luciana
              </p>
            </div>
          </div>

          {/* Seleção de Colunas */}
          <div className="mt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Selecione as colunas para visualização dos dados:
            </h3>
            <div className="flex flex-wrap gap-2">
              {todasColunas.map((coluna) => (
                <label key={coluna.id} className="flex items-center space-x-2 bg-gray-100 px-3 py-2 rounded-lg">
                  <input
                    type="checkbox"
                    checked={colunasSelecionadas.includes(coluna.id)}
                    onChange={() => alternarColuna(coluna.id)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">{coluna.nome}</span>
                </label>
              ))}
              <label className="flex items-center space-x-2 bg-blue-100 px-3 py-2 rounded-lg">
                <input
                  type="checkbox"
                  checked={colunasSelecionadas.includes('status_portaria')}
                  onChange={() => alternarColuna('status_portaria')}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-blue-700">Status</span>
              </label>
            </div>
          </div>

          {/* Refine o resultado da busca por filtragem */}
          <div className="mt-6">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-semibold text-gray-900">
                Refine o resultado da busca por filtragem:
              </h3>
              <div className="flex gap-2">
                {/* Mostra "Limpar seleções" apenas se houver seleções temporárias E não houver filtros aplicados */}
                {temFiltrosTemp && !temFiltrosAplicados && (
                  <button
                    onClick={() => {
                      setFiltroAnosTemp([])
                      setFiltroPortariasTemp([])
                      setFiltroTiposTemp([])
                      setFiltroRegimentosTemp([])
                      setFiltroRetificadosTemp([])
                      setFiltroStatusTemp([])
                    }}
                    className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                  >
                    Limpar seleções
                  </button>
                )}
                {temFiltrosAplicados && (
                  <button
                    onClick={limparTodosFiltros}
                    className="px-3 py-1 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    Remover filtros
                  </button>
                )}
              </div>
            </div>

            {/* Filtros (dropdowns) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 items-start">
              <MultiSelectDropdown
                label="Ano"
                options={anos}
                selected={filtroAnosTemp}
                onChange={setFiltroAnosTemp}
                onApply={aplicarFiltrosHandler}
                onRemove={removerFiltroAno}
                isApplied={filtroInalterado(filtroAnosTemp, filtroAnos)}
                placeholder="Selecione anos"
              />
              <MultiSelectDropdown
                label="Portaria"
                options={portariasFiltro}
                selected={filtroPortariasTemp}
                onChange={setFiltroPortariasTemp}
                onApply={aplicarFiltrosHandler}
                onRemove={removerFiltroPortaria}
                isApplied={filtroInalterado(filtroPortariasTemp, filtroPortarias)}
                placeholder="Selecione portarias"
              />
              <MultiSelectDropdown
                label="Tipo"
                options={tipos}
                selected={filtroTiposTemp}
                onChange={setFiltroTiposTemp}
                onApply={aplicarFiltrosHandler}
                onRemove={removerFiltroTipo}
                isApplied={filtroInalterado(filtroTiposTemp, filtroTipos)}
                placeholder="Selecione tipos"
              />
              <MultiSelectDropdown
                label="Regimento Normativo"
                options={regimentos}
                selected={filtroRegimentosTemp}
                onChange={setFiltroRegimentosTemp}
                onApply={aplicarFiltrosHandler}
                onRemove={removerFiltroRegimento}
                isApplied={filtroInalterado(filtroRegimentosTemp, filtroRegimentos)}
                placeholder="Selecione regimentos"
              />
              <MultiSelectDropdown
                label="Autorização Retificada?"
                options={retificados}
                selected={filtroRetificadosTemp}
                onChange={setFiltroRetificadosTemp}
                onApply={aplicarFiltrosHandler}
                onRemove={removerFiltroRetificado}
                isApplied={filtroInalterado(filtroRetificadosTemp, filtroRetificados)}
                placeholder="Selecione"
              />
              <MultiSelectDropdown
                label="Status"
                options={opcoesStatus}
                selected={filtroStatusTemp}
                onChange={setFiltroStatusTemp}
                onApply={aplicarFiltrosHandler}
                onRemove={removerFiltroStatus}
                isApplied={filtroInalterado(filtroStatusTemp, filtroStatusList)}
                placeholder="Selecione status"
              />
            </div>
          </div>
        </div>

        {/* Tabela de Resultados */}
        <div className="bg-white rounded-lg shadow overflow-hidden mx-2 sm:mx-0">
          <div className="overflow-x-auto">
            <div
              ref={bodyRef}
              className="overflow-x-auto"
              style={{ maxHeight: 'calc(100vh - 400px)', overflow: 'auto' }}
            >
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    {getColunasOrdenadasParaExibicao().map(coluna => (
                      <th
                        key={coluna.id}
                        className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap bg-gray-50"
                        style={{ minWidth: '120px' }}
                      >
                        {coluna.nome}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {dadosExibicao.map((portaria) => (
                    <tr key={portaria[PRIMARY_KEY]} className="hover:bg-gray-50">
                      {getColunasOrdenadasParaExibicao().map(coluna => (
                        <td
                          key={coluna.id}
                          className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                          style={{ minWidth: '120px' }}
                        >
                          {coluna.id === 'status_portaria' ? (
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${obterClasseStatus(calcularStatus(portaria))}`}
                            >
                              {calcularStatus(portaria)}
                            </span>
                          ) : (
                            renderizarConteudoCelula(coluna.id, portaria[coluna.id] || 'N/A')
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ÁREA DE CONTROLE - Contador, Paginação e Exportação */}
          <div className="bg-gray-50 px-4 sm:px-6 py-4 border-t border-gray-200">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">

              {/* Informações de paginação */}
              <div className="text-sm text-gray-700">
                {mostrandoTodos || buscaAplicada ? (
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <span>
                      Página {paginaAtual} de {totalPaginas} {' '}
                      ({dadosExibicao.length} de {dadosFiltrados.length} registros)
                    </span>
                    {totalPaginas > 1 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={voltarPagina}
                          disabled={paginaAtual === 1}
                          className="px-3 py-1 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Anterior
                        </button>
                        <div className="flex gap-1 flex-wrap">{gerarBotoesPagina()}</div>
                        <button
                          onClick={avancarPagina}
                          disabled={paginaAtual === totalPaginas}
                          className="px-3 py-1 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Próximo
                        </button>
                        <span>
                          Ir para página
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="1"
                          max={totalPaginas}
                          value={paginaInput}
                          onChange={e => setPaginaInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              irParaPagina()
                            }
                          }}
                          className="w-16 border rounded px-2 py-1"
                        />
                        <button
                          type="button"
                          onClick={() => irParaPagina()}
                          className="border rounded px-3 py-1 text-sm hover:bg-gray-100"
                        >
                          Ir
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <span>
                    Mostrando <span className="font-semibold">{dadosExibicao.length}</span> registros mais recentes
                    {buscaAplicada && (
                      <span> para '<span className="font-semibold">{buscaAplicada}</span>'</span>
                    )}
                  </span>
                )}
              </div>

              {/* BOTÕES DE AÇÃO */}
              <div className="flex gap-3">
                {(todosRegistros.length > 0) && (
                  <button
                    onClick={handleExportarCSV}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {(() => {
                      const { dados } = getDadosParaExportar()
                      const quantidade = dados.length
                      if (buscaAplicada && buscaAplicada.trim() !== '') {
                        return `Exportar resultados da busca (${quantidade} registros)`
                      } else if (temFiltrosAplicados) {
                        return `Exportar resultados filtrados (${quantidade} registros)`
                      } else if (mostrandoTodos) {
                        return `Exportar todos os dados (${quantidade} registros)`
                      } else {
                        return `Exportar todos os dados (${quantidade} registros)`
                      }
                    })()}
                  </button>
                )}

                {!mostrandoTodos && !buscaAplicada && !temFiltrosAplicados && (
                  <button
                    onClick={carregarMaisRegistros}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                  >
                    Ver mais registros de portarias
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Rodapé */}
        <div className="mt-6 sm:mt-8 text-center text-gray-500 text-sm px-2">
          <p>
            Última atualização: {dataAtualizacao || 'Carregando...'}
          </p>
        </div>
      </div>
    </div>
  )
}