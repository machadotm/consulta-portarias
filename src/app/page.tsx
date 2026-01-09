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
  { id: 'retificado', nome: 'Portaria Retificada?' },
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
  { id: 'quantidade_retificado_dou', nome: 'Quantidade de Retificações da Portaria no DOU' },
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
        // Calcular status para exportação
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

        // NOVO STATUS: Vigente Retificado
        if (
          vigente &&
          Number(portaria.quantidade_retificado_dou) > 0 &&
          portaria.ultimo_link_retificado_dou &&
          portaria.ultimo_link_retificado_dou.trim() !== ''
        ) {
          return 'Vigente Retificado'
        }

        // Vigente normal
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
  const [buscaDisparada, setBuscaDisparada] = useState(0)
  const [paginaInput, setPaginaInput] = useState('')
  
  // Estados: Paginação
  const [paginaAtual, setPaginaAtual] = useState(1)
  const [itensPorPagina] = useState(100)
  const [totalPaginas, setTotalPaginas] = useState(1)
  const [totalRegistros, setTotalRegistros] = useState(0)

  // Estados: Filtros (removido Data de Publicação no DOU e Enquadramento IN)
  const [filtroAno, setFiltroAno] = useState<string>('')
  const [filtroPortaria, setFiltroPortaria] = useState<string>('')
  const [filtroTipo, setFiltroTipo] = useState<string>('')
  const [filtroRegimento, setFiltroRegimento] = useState<string>('')
  const [filtroStatus, setFiltroStatus] = useState<string>('')

  const [isClient, setIsClient] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setIsClient(true)
  }, [])

  // Carregar todos os dados
  useEffect(() => {
    const buscarDados = async () => {
      try {
        setCarregando(true)
        const todos = await buscarTodosDados()
        setPortarias(todos)
        setTodosRegistros(todos)
        setTotalRegistros(todos.length)

        // Buscar a última data de atualização
        const { data: dataAtualizacao, error: errorAtualizacao } = await supabase
          .from('portarias_iphan')
          .select('updated_at')
          .order('updated_at', { ascending: false })
          .limit(1)

        if (!errorAtualizacao && dataAtualizacao && dataAtualizacao.length > 0) {
          const dataUTC = new Date(dataAtualizacao[0].updated_at)
          const dataBrasilia = new Date(dataUTC.getTime() - 3 * 60 * 60 * 1000)
          const dia = dataBrasilia.getUTCDate().toString().padStart(2, '0')
          const mes = (dataBrasilia.getUTCMonth() + 1).toString().padStart(2, '0')
          const ano = dataBrasilia.getUTCFullYear()
          setDataAtualizacao(`${dia}/${mes}/${ano}`)
        }
      } catch (err) {
        console.error('Erro ao carregar dados:', err)
      } finally {
        setCarregando(false)
      }
    }

    buscarDados()
  }, [])

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
    // CONDIÇÃO: Verificar se é Revogado
    if (portaria.tipo && 
        normalizarTexto(portaria.tipo).includes('revogacao') && 
        portaria.link_revogado_dou && 
        portaria.link_revogado_dou.trim() !== '') {
      return 'Revogada'
    }

    // Lógica original para Vigente/Expirada
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

    // NOVO STATUS: Vigente Retificado
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

  // Busca textual nos dados já carregados
  const aplicarBusca = useCallback((termo: string, dados: any[]) => {
    if (!termo.trim()) return dados
    
    const termoNormalizado = normalizarTexto(termo)
    
    return dados.filter(portaria => {
      const camposBusca = [
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
      ]
        .filter(Boolean)
        .join(' ')
      
      const textoNormalizado = normalizarTexto(camposBusca)
      return textoNormalizado.includes(termoNormalizado)
    })
  }, [])

  // Aplicar filtros (removido Data de Publicação no DOU e Enquadramento IN)
  const obterDadosFiltrados = useCallback((dados: any[]) => {
    let resultados = dados

    // Filtro de Ano
    if (filtroAno) {
      resultados = resultados.filter(portaria => 
        portaria.ano?.toString() === filtroAno || 
        (filtroAno === 'NULL' && (portaria.ano === null || portaria.ano === undefined))
      )
    }

    // Filtro de Portaria
    if (filtroPortaria) {
      resultados = resultados.filter(portaria => {
        const valorPortaria = portaria.portaria || ''
        const valorNormalizado = normalizarTexto(valorPortaria)
        const filtroNormalizado = normalizarTexto(filtroPortaria)
        if (filtroPortaria === 'NULL') {
          return !portaria.portaria || portaria.portaria.trim() === ''
        }
        return valorNormalizado.includes(filtroNormalizado)
      })
    }

    // Filtro de Tipo
    if (filtroTipo) {
      resultados = resultados.filter(portaria => {
        const valorTipo = portaria.tipo || ''
        const valorNormalizado = normalizarTexto(valorTipo)
        const filtroNormalizado = normalizarTexto(filtroTipo)
        if (filtroTipo === 'NULL') {
          return !portaria.tipo || portaria.tipo.trim() === ''
        }
        return valorNormalizado.includes(filtroNormalizado)
      })
    }

    // Filtro de Regimento Normativo
    if (filtroRegimento) {
      resultados = resultados.filter(portaria => {
        const valorRegimento = portaria.regimento_normativo || ''
        const valorNormalizado = normalizarTexto(valorRegimento)
        const filtroNormalizado = normalizarTexto(filtroRegimento)
        if (filtroRegimento === 'NULL') {
          return !portaria.regimento_normativo || portaria.regimento_normativo.trim() === ''
        }
        return valorNormalizado.includes(filtroNormalizado)
      })
    }

    // Filtro de Status
    if (filtroStatus) {
      resultados = resultados.filter(portaria => calcularStatus(portaria) === filtroStatus)
    }

    return resultados
  }, [filtroAno, filtroPortaria, filtroTipo, filtroRegimento, filtroStatus])

  // Atualizar dados filtrados quando base/filtros mudam
useEffect(() => {
  // 🔒 Se estiver no modo inicial E não houver interação do usuário, não faz nada
  if (
    modoInicial &&
    !buscaAplicada &&
    !filtroAno &&
    !filtroPortaria &&
    !filtroTipo &&
    !filtroRegimento &&
    !filtroStatus
  ) {
    return
  }

  // A partir daqui, já estamos em modo de consulta
  setModoInicial(false)
  setMostrandoTodos(true)

  let base = todosRegistros

  // Busca textual
  if (buscaAplicada.trim()) {
    base = aplicarBusca(buscaAplicada, base)
  }

  // Filtros refinados
  const resultados = obterDadosFiltrados(base)

  setDadosFiltrados(resultados)
  setDadosFiltrados(resultados)
  setPaginaAtual(1)
  setTotalPaginas(Math.ceil(resultados.length / itensPorPagina))
}, [
  buscaAplicada,
  buscaDisparada,
  filtroAno,
  filtroPortaria,
  filtroTipo,
  filtroRegimento,
  filtroStatus,
  todosRegistros,
  aplicarBusca,
  obterDadosFiltrados,
  itensPorPagina,
  modoInicial
])

  // Ações de busca
const executarBusca = () => {
  setModoInicial(false)
  setMostrandoTodos(true)
  setBuscaAplicada(termoBuscaInput)
  setBuscaDisparada(prev => prev + 1) // 👈 força atualização completa
  setPaginaAtual(1)
}

  const limparBusca = () => {
    setModoInicial(true)
    setMostrandoTodos(false)
    setTermoBuscaInput('')
    setBuscaAplicada('')
    setPaginaAtual(1)
    
    // Restaurar exibição inicial de 5 registros
    const registrosVigentes = portarias.filter(portaria => {
      const status = calcularStatus(portaria)
      return status === 'Vigente' || status === 'Vigente Retificado'
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
    setMostrandoTodos(false)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') executarBusca()
  }

  // Limpar todos os filtros
  const limparTodosFiltros = () => {
    setFiltroAno('')
    setFiltroPortaria('')
    setFiltroTipo('')
    setFiltroRegimento('')
    setFiltroStatus('')
  }

  // Carregar mais registros (Ver mais registros de portarias)
const carregarMaisRegistros = () => {
  setModoInicial(false)        // 👈 DESLIGA o modo inicial
  setMostrandoTodos(true)
  setDadosFiltrados(todosRegistros)  
  setPaginaAtual(1)
}

  // Obter opções únicas para filtros
  const obterValoresUnicos = useCallback((dados: any[], campo: string) => {
    const valoresProcessados = dados
      .map(item => item[campo])
      .map(valor => !valor || valor.toString().trim() === '' ? 'Não informado' : valor.toString().trim())
    const valoresUnicos = [...new Set(valoresProcessados)]
    const naoInformado = valoresUnicos.filter(v => v === 'Não informado')
    const outros = valoresUnicos.filter(v => v !== 'Não informado').sort()
    return [...naoInformado, ...outros]
  }, [])

  const obterOpcoesFiltro = useCallback(() => {
    const dadosParaAno = obterDadosFiltrados(dadosFiltrados)
    const anos = [...new Set(dadosParaAno.map((item: any) => item.ano).filter((ano: any) => ano != null))].sort((a: number, b: number) => b - a)
    
    const dadosParaPortaria = obterDadosFiltrados(dadosFiltrados)
    const portariasFiltro = obterValoresUnicos(dadosParaPortaria, 'portaria')
    
    const dadosParaTipo = obterDadosFiltrados(dadosFiltrados)
    const tipos = obterValoresUnicos(dadosParaTipo, 'tipo')
    
    const dadosParaRegimento = obterDadosFiltrados(dadosFiltrados)
    const regimentos = obterValoresUnicos(dadosParaRegimento, 'regimento_normativo')
    
    return { anos, portariasFiltro, tipos, regimentos }
  }, [dadosFiltrados, obterDadosFiltrados, obterValoresUnicos])

  const { anos, portariasFiltro, tipos, regimentos } = obterOpcoesFiltro()

  // Obter opções de status
  const obterOpcoesStatus = useCallback(() => {
    const dadosParaStatus = obterDadosFiltrados(dadosFiltrados)
    const statusUnicos = [...new Set(dadosParaStatus.map(portaria => calcularStatus(portaria)))].sort()
    return statusUnicos
  }, [dadosFiltrados, obterDadosFiltrados])

  const opcoesStatus = obterOpcoesStatus()

  // Exportação
  const getDadosParaExportar = () => {
    if (buscaAplicada && buscaAplicada.trim() !== '') {
      return {
        dados: dadosFiltrados,
        nome: `portarias_busca_${buscaAplicada.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`
      }
    }
    if (filtroAno || filtroPortaria || filtroTipo || filtroRegimento || filtroStatus) {
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

  if (
    !pagina ||
    pagina < 1 ||
    pagina > totalPaginas
  ) {
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

    // ✅ Renderização especial para múltiplas retificações
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

    // ✅ Renderização normal de links únicos
    if (
      colunaId === 'link_portaria_dou' ||
      colunaId === 'ultimo_link_retificado_dou' ||
      colunaId === 'link_revogado_dou'
    ) {
      if (valor.startsWith('http')) {
        return (
          <RenderizarLink
            url={valor}
            texto={
              colunaId === 'link_portaria_dou'
                ? 'Ver portaria'
                : colunaId === 'link_revogado_dou'
                ? 'Ver revogação'
                : 'Ver retificação'
            }
          />
        )
      }
    }

    return valor
  }

  // Função para obter a classe CSS do status
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

  // Gerar botões de paginação
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

  // Obter colunas ordenadas para exibição
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
                  onKeyPress={handleKeyPress}
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
                    {' '}- Buscando por: "{buscaAplicada}"
                  </span>
                )}
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
              {(filtroAno || filtroPortaria || filtroTipo || filtroRegimento || filtroStatus) && (
                <button
                  onClick={limparTodosFiltros}
                  className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Limpar filtros
                </button>
              )}
            </div>
            <div className="grid grid-cols-6 gap-2 items-center">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ano</label>
                <select
                  value={filtroAno}
                  onChange={(e) => setFiltroAno(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                >
                  <option value="">Todos</option>
                  {anos.map(ano => (
                    <option key={ano} value={ano}>{ano}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Portaria</label>
                <select
                  value={filtroPortaria}
                  onChange={(e) => setFiltroPortaria(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                >
                  <option value="">Todas</option>
                  {portariasFiltro.map(portaria => (
                    <option key={portaria} value={portaria === 'Não informado' ? 'NULL' : portaria}>
                      {portaria}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                <select
                  value={filtroTipo}
                  onChange={(e) => setFiltroTipo(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                >
                  <option value="">Todos</option>
                  {tipos.map(tipo => (
                    <option key={tipo} value={tipo === 'Não informado' ? 'NULL' : tipo}>
                      {tipo}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Regimento Normativo</label>
                <select
                  value={filtroRegimento}
                  onChange={(e) => setFiltroRegimento(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                >
                  <option value="">Todos</option>
                  {regimentos.map(regimento => (
                    <option key={regimento} value={regimento === 'Não informado' ? 'NULL' : regimento}>
                      {regimento}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={filtroStatus}
                  onChange={(e) => setFiltroStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                >
                  <option value="">Todos</option>
                  {opcoesStatus.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>
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
                            min="1"
                            max={totalPaginas}
                            value={paginaInput}
                            onChange={e => setPaginaInput(e.target.value)}
                              onKeyDown={e => {                                
                                if (e.key === 'Enter') {
                                  irParaPagina()
                                }
                              }}
                            className="w-10 border rounded px-2 py-1"                            
                          />
                          <button
                            type="button"
                            onClick={() => irParaPagina()}
                            className="
                              border
                              rounded
                              px-3
                              py-1
                              text-sm
                              hover:bg-gray-100
                            "
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
                      } else if (filtroAno || filtroPortaria || filtroTipo || filtroRegimento || filtroStatus) {
                        return `Exportar resultados filtrados (${quantidade} registros)`
                      } else if (mostrandoTodos) {
                        return `Exportar todos os dados (${quantidade} registros)`
                      } else {
                        return `Exportar todos os dados (${quantidade} registros)`
                      }
                    })()}
                  </button>
                )}

                {!mostrandoTodos && !buscaAplicada && !filtroAno && !filtroPortaria && !filtroTipo && !filtroRegimento && !filtroStatus && (
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