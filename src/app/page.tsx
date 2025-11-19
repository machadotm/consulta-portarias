'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

// Configuração do Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Lista de todas as colunas disponíveis
const todasColunas = [
  { id: 'portaria', nome: 'Portaria' },
  { id: 'data_publicacao_dou', nome: 'Data de Publicação no DOU' },
  { id: 'anexo', nome: 'Anexo' },
  { id: 'n_autorizacao', nome: 'Nº da Autorização' },
  { id: 'tipo', nome: 'Tipo' },
  { id: 'regimento_normativo', nome: 'Regimento Normativo' },
  { id: 'retificado', nome: 'Portaria Retificada?' },
  { id: 'processo', nome: 'Nº do Processo' },
  { id: 'enquadramento_in', nome: 'Enquadramento IN' },  
  { id: 'empreendedor', nome: 'Empreendedor' },
  { id: 'empreendimento', nome: 'Empreendimento' },
  { id: 'projeto', nome: 'Nome do Projeto' },
  { id: 'arqueologos_coordenadores', nome: 'Arqueólogos Coordenadores' },
  { id: 'arqueologos_campo', nome: 'Arqueólogos de Campo' },
  { id: 'apoio_institucional', nome: 'Apoio Institucional' },
  { id: 'municipios_abrangencias', nome: 'Municípios' },
  { id: 'estados_abrangencias', nome: 'Estados' },
  { id: 'prazo_validade', nome: 'Prazo de Validade da Portaria' },
  { id: 'data_expiracao', nome: 'Data de Expiração da Portaria' },
  { id: 'link_portaria_dou', nome: 'Link da Portaria no DOU' },
  { id: 'quantidade_retificado_dou', nome: 'Quantidade de Retificações da Portaria no DOU' },
  { id: 'ultimo_link_retificado_dou', nome: 'Última Retificação da Portaria no DOU' },
  { id: 'link_revogado_dou', nome: 'Link da Portaria Revogada no DOU' },
]

// Função para remover acentos e caracteres especiais
const normalizarTexto = (texto: string): string => {
  if (!texto) return ''
  
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
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

// 🔒 FUNÇÃO SEGURA: Exportar para CSV (sem bibliotecas vulneráveis)
const exportarParaCSV = (dados: any[], colunasSelecionadas: string[], todasColunas: any[], nomeArquivo: string = `portarias_iphan_${new Date().toISOString().split('T')[0]}.csv`) => {
  if (dados.length === 0) {
    alert('Não há dados para exportar.')
    return
  }

  // ORDENAR AS COLUNAS SELECIONADAS NA MESMA ORDEM DA VISUALIZAÇÃO
  // A ordem deve ser: primeiro status (se selecionado), depois as demais colunas na ordem de todasColunas
  const colunasOrdenadas: string[] = [];
  
  // Se status_portaria está selecionado, adiciona primeiro
  if (colunasSelecionadas.includes('status_portaria')) {
    colunasOrdenadas.push('status_portaria');
  }
  
  // Depois adiciona as demais colunas na ordem de todasColunas
  todasColunas.forEach(coluna => {
    if (colunasSelecionadas.includes(coluna.id) && coluna.id !== 'status_portaria') {
      colunasOrdenadas.push(coluna.id);
    }
  });

  // Preparar cabeçalhos
  const headers = colunasOrdenadas.map(colunaId => {
    if (colunaId === 'status_portaria') return 'Status'
    const coluna = todasColunas.find(c => c.id === colunaId)
    return coluna ? coluna.nome : colunaId
  })

  // Preparar dados
  const linhas = dados.map(portaria => {
    return colunasOrdenadas.map(colunaId => {
      if (colunaId === 'status_portaria') {
        // Calcular status para exportação
        if (portaria.tipo && 
            normalizarTexto(portaria.tipo).includes('revogacao') && 
            portaria.link_revogado_dou && 
            portaria.link_revogado_dou.trim() !== '') {
          return 'Revogado'
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
        
        return dataExp > hoje ? 'Vigente' : 'Expirada'
      }
      return `"${(portaria[colunaId] || 'N/A').toString().replace(/"/g, '""')}"`
    }).join(',')
  })

  // Combinar cabeçalhos e dados
  const csvContent = [headers.join(','), ...linhas].join('\n')
  
  // Criar e fazer download do arquivo
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

export default function ConsultaPortarias() {
  const [portarias, setPortarias] = useState<any[]>([])
  const [todosRegistros, setTodosRegistros] = useState<any[]>([])
  const [dadosFiltrados, setDadosFiltrados] = useState<any[]>([])
  const [dadosExibicao, setDadosExibicao] = useState<any[]>([])
  const [busca, setBusca] = useState('')
  const [colunasSelecionadas, setColunasSelecionadas] = useState([
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
  ])
  const [carregando, setCarregando] = useState(true)
  const [dataAtualizacao, setDataAtualizacao] = useState<string>('')
  const [mostrandoTodos, setMostrandoTodos] = useState(false)
  
  // Estados: Paginação
  const [paginaAtual, setPaginaAtual] = useState(1)
  const [itensPorPagina] = useState(20)
  const [totalPaginas, setTotalPaginas] = useState(1)
  const [totalRegistros, setTotalRegistros] = useState(0)

  // Buscar dados do Supabase
  useEffect(() => {
    const buscarDados = async () => {
      try {
        // Buscar TODOS os dados sem limite
        const { data, error, count } = await supabase
          .from('portarias_iphan')
          .select('*', { count: 'exact' })
          .order('data_publicacao_dou', { ascending: false })

        if (error) {
          console.error('Erro:', error)
        } else {
          setPortarias(data || [])
          setTodosRegistros(data || [])
          setTotalRegistros(count || 0)
          
          // Buscar a última data de atualização
          const { data: dataAtualizacao, error: errorAtualizacao } = await supabase
            .from('portarias_iphan')
            .select('updated_at')
            .order('updated_at', { ascending: false })
            .limit(1)

          if (!errorAtualizacao && dataAtualizacao && dataAtualizacao.length > 0) {
            // Converter timestamptz para dd/mm/aaaa no horário de Brasília
            const dataUTC = new Date(dataAtualizacao[0].updated_at)
            // Horário de Brasília (UTC-3)
            const dataBrasilia = new Date(dataUTC.getTime() - 3 * 60 * 60 * 1000)
            const dia = dataBrasilia.getUTCDate().toString().padStart(2, '0')
            const mes = (dataBrasilia.getUTCMonth() + 1).toString().padStart(2, '0')
            const ano = dataBrasilia.getUTCFullYear()
            setDataAtualizacao(`${dia}/${mes}/${ano}`)
          }
        }
      } catch (err) {
        console.error('Erro ao carregar dados:', err)
      } finally {
        setCarregando(false)
      }
    }

    buscarDados()
  }, [])

  // Efeito para exibição automática inicial - 5 registros recentes com status vigente
  useEffect(() => {
    if (portarias.length === 0) return

    // Filtrar apenas registros com status Vigente
    const registrosVigentes = portarias.filter(portaria => {
      const status = calcularStatus(portaria)
      return status === 'Vigente'
    })

    // Ordenar por data de publicação mais recente e pegar os 5 primeiros
    const registrosRecentes = registrosVigentes
      .sort((a, b) => {
        const [diaA, mesA, anoA] = (a.data_publicacao_dou || '').split('/').map(Number)
        const [diaB, mesB, anoB] = (b.data_publicacao_dou || '').split('/').map(Number)
        const dataA = new Date(anoA, mesA - 1, diaA)
        const dataB = new Date(anoB, mesB - 1, diaB)
        return dataB.getTime() - dataA.getTime()
      })
      .slice(0, 5)

    setDadosFiltrados(registrosRecentes)
    setDadosExibicao(registrosRecentes)
    setMostrandoTodos(false)
    setPaginaAtual(1)
  }, [portarias])

  // Efeito: Atualizar paginação quando dadosFiltrados mudam
  useEffect(() => {
    if (mostrandoTodos || busca) {
      // Calcular total de páginas apenas no modo completo ou busca
      const total = Math.ceil(dadosFiltrados.length / itensPorPagina)
      setTotalPaginas(total)
      
      // Calcular dados para exibição na página atual
      const inicio = (paginaAtual - 1) * itensPorPagina
      const fim = inicio + itensPorPagina
      setDadosExibicao(dadosFiltrados.slice(inicio, fim))
    } else {
      // No modo inicial, exibir todos os dados filtrados (5 registros)
      setDadosExibicao(dadosFiltrados)
    }
  }, [dadosFiltrados, paginaAtual, itensPorPagina, mostrandoTodos, busca])

  // Função para calcular status - Inclui status "Revogado"
  const calcularStatus = (portaria: any) => {
    // CONDIÇÃO: Verificar se é Revogado
    if (portaria.tipo && 
        normalizarTexto(portaria.tipo).includes('revogacao') && 
        portaria.link_revogado_dou && 
        portaria.link_revogado_dou.trim() !== '') {
      return 'Revogado'
    }

    // Lógica original para Vigente/Expirada
    const dataExpiracao = portaria.data_expiracao
    if (!dataExpiracao || dataExpiracao.trim() === '') return 'Data não informada'
    
    // Verificar formato dd/mm/aaaa
    const regexData = /^(\d{2})\/(\d{2})\/(\d{4})$/
    const match = dataExpiracao.match(regexData)
    
    if (!match) return 'Formato inválido'
    
    const dia = parseInt(match[1])
    const mes = parseInt(match[2]) - 1 // Mês em JS é 0-11
    const ano = parseInt(match[3])
    const dataExp = new Date(ano, mes, dia)
    
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0) // Zerar horas para comparar só a data
    
    return dataExp > hoje ? 'Vigente' : 'Expirada'
  }

  // Busca dinâmica no Supabase - case-insensitive e sem caracteres especiais
  const handleBusca = async (termo: string) => {
    setBusca(termo)
    
    if (!termo.trim()) {
      // Se busca vazia, voltar para exibição inicial automática (5 registros vigentes)
      const registrosVigentes = portarias.filter(portaria => {
        const status = calcularStatus(portaria)
        return status === 'Vigente'
      })

      const registrosRecentes = registrosVigentes
        .sort((a, b) => {
          const [diaA, mesA, anoA] = (a.data_publicacao_dou || '').split('/').map(Number)
          const [diaB, mesB, anoB] = (b.data_publicacao_dou || '').split('/').map(Number)
          const dataA = new Date(anoA, mesA - 1, diaA)
          const dataB = new Date(anoB, mesB - 1, diaB)
          return dataB.getTime() - dataA.getTime()
        })
        .slice(0, 5)

      setDadosFiltrados(registrosRecentes)
      setMostrandoTodos(false)
      setPaginaAtual(1)
      return
    }

    // Busca dinâmica no Supabase - SEM LIMITE
    try {
      // Normalizar o termo de busca (remover acentos e converter para minúsculas)
      const termoNormalizado = normalizarTexto(termo)
      
      // Buscar todos os dados primeiro
      const { data: todosDados, error } = await supabase
        .from('portarias_iphan')
        .select('*')

      if (error) {
        console.error('Erro na busca:', error)
        return
      }

      if (!todosDados) {
        setDadosFiltrados([])
        setDadosExibicao([])
        return
      }

      // Filtro local normalizado (case-insensitive e sem acentos)
      const resultadosFiltrados = todosDados.filter(portaria => {
        // Criar uma string com todos os campos de texto concatenados
        const textoCompleto = [
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
          portaria.tipo
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        // Normalizar o texto completo (remover acentos)
        const textoNormalizado = normalizarTexto(textoCompleto)
        
        // Verificar se o termo normalizado está contido no texto normalizado
        return textoNormalizado.includes(termoNormalizado)
      })

      setDadosFiltrados(resultadosFiltrados)
      setMostrandoTodos(true) // Quando busca, mostra todos os resultados
      setPaginaAtual(1)
    } catch (err) {
      console.error('Erro na busca:', err)
    }
  }

  // FUNÇÃO: Carregar todos os registros com paginação
  const carregarMaisRegistros = () => {
    setDadosFiltrados(todosRegistros)
    setMostrandoTodos(true)
    setPaginaAtual(1)
  }

  // FUNÇÃO: Determinar quais dados exportar
  const getDadosParaExportar = () => {
    // Se há uma busca ativa, exportar os resultados da busca
    if (busca && busca.trim() !== '') {
      return {
        dados: dadosFiltrados,
        nome: `portarias_busca_${busca.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`
      }
    }
    
    // Se está no modo "ver todos", exportar todos os registros
    if (mostrandoTodos) {
      return {
        dados: todosRegistros,
        nome: `portarias_completas_${new Date().toISOString().split('T')[0]}.csv`
      }
    }
    
    // Caso contrário (modo inicial), exportar todos os registros
    return {
      dados: todosRegistros,
      nome: `portarias_iphan_${new Date().toISOString().split('T')[0]}.csv`
    }
  }

  // FUNÇÃO: Exportar dados
  const handleExportarCSV = () => {
    const { dados, nome } = getDadosParaExportar()
    exportarParaCSV(dados, colunasSelecionadas, todasColunas, nome)
  }

  // FUNÇÕES: Navegação de páginas
  const irParaPagina = (pagina: number) => {
    setPaginaAtual(pagina)
  }

  const avancarPagina = () => {
    if (paginaAtual < totalPaginas) {
      setPaginaAtual(paginaAtual + 1)
    }
  }

  const voltarPagina = () => {
    if (paginaAtual > 1) {
      setPaginaAtual(paginaAtual - 1)
    }
  }

  // Alternar seleção de coluna
  const alternarColuna = (colunaId: string) => {
    if (colunasSelecionadas.includes(colunaId)) {
      setColunasSelecionadas(colunasSelecionadas.filter(c => c !== colunaId))
    } else {
      setColunasSelecionadas([...colunasSelecionadas, colunaId])
    }
  }

  // Função para renderizar o conteúdo da célula com links clicáveis quando aplicável
  const renderizarConteudoCelula = (colunaId: string, valor: string) => {
    if (!valor || valor === 'N/A') {
      return <span className="text-gray-500">N/A</span>
    }

    // Verificar se é uma coluna de link
    if (colunaId === 'link_portaria_dou' || 
        colunaId === 'ultimo_link_retificado_dou' || 
        colunaId === 'link_revogado_dou') {
      
      // Verificar se o valor é uma URL válida
      if (valor.startsWith('http')) {
        return (
          <RenderizarLink 
            url={valor} 
            texto={colunaId === 'link_portaria_dou' ? 'Ver portaria' : 
                   colunaId === 'ultimo_link_retificado_dou' ? 'Ver retificação' : 
                   'Ver revogação'} 
          />
        )
      }
    }

    // Para outras colunas, retornar o texto normal
    return valor
  }

  // Função para obter a classe CSS do status
  const obterClasseStatus = (status: string) => {
    switch (status) {
      case 'Vigente':
        return 'bg-green-100 text-green-800'
      case 'Expirada':
        return 'bg-red-100 text-red-800'
      case 'Revogado':
        return 'bg-orange-100 text-orange-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  // FUNÇÃO: Gerar botões de paginação
  const gerarBotoesPagina = () => {
    const botoes = []
    const maxBotoes = 5
    
    let inicio = Math.max(1, paginaAtual - Math.floor(maxBotoes / 2))
    let fim = Math.min(totalPaginas, inicio + maxBotoes - 1)
    
    // Ajustar início se necessário
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

  // FUNÇÃO: Obter texto do botão de exportação
  const getTextoExportacao = () => {
    const { dados } = getDadosParaExportar()
    const quantidade = dados.length
    
    if (busca && busca.trim() !== '') {
      return `Exportar Resultados da Busca (${quantidade} registros)`
    } else if (mostrandoTodos) {
      return `Exportar Todos os Registros (${quantidade} registros)`
    } else {
      return `Exportar Todos os Registros (${quantidade} registros)`
    }
  }

  // FUNÇÃO: Obter colunas ordenadas para exibição (igual à tabela)
  const getColunasOrdenadasParaExibicao = () => {
    const colunasOrdenadas: {id: string, nome: string}[] = [];
    
    // Status sempre vem primeiro se estiver selecionado
    if (colunasSelecionadas.includes('status_portaria')) {
      colunasOrdenadas.push({ id: 'status_portaria', nome: 'Status' });
    }
    
    // Depois as demais colunas na ordem de todasColunas
    todasColunas.forEach(coluna => {
      if (colunasSelecionadas.includes(coluna.id) && coluna.id !== 'status_portaria') {
        colunasOrdenadas.push(coluna);
      }
    });
    
    return colunasOrdenadas;
  }

  if (carregando) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Carregando dados...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Cabeçalho */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Consulta de Portarias Autorizativas Extraídas do DOU
          </h1>
          <p className="text-gray-900">
            Dados extraídos a partir da Portaria nº 101/2025 - Publicada no DOU em 06/11/2025
          </p>
          <p className="text-gray-600">            
            Busque e filtre as informações de acordo com suas necessidades
          </p>
        </div>

        {/* Barra de Busca */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="🔍 Buscar por nome de arqueólogos, processos, projetos, municípios..."
                value={busca}
                onChange={(e) => handleBusca(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
              />
            </div>
          </div>

          {/* Seleção de Colunas */}
          <div className="mt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Selecione as colunas para visualização dos dados:
            </h3>
            <div className="flex flex-wrap gap-3">
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
              {/* Status Portaria (sempre disponível) */}
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
        </div>

        {/* Tabela de Resultados */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {getColunasOrdenadasParaExibicao().map(coluna => (
                    <th key={coluna.id} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {coluna.nome}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {dadosExibicao.map((portaria) => (
                  <tr key={portaria.id} className="hover:bg-gray-50">
                    {getColunasOrdenadasParaExibicao().map(coluna => (
                      <td key={coluna.id} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
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

          {/* ÁREA DE CONTROLE - Contador, Paginação e Exportação */}
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
              
              {/* Informações de paginação */}
              <div className="text-sm text-gray-700">
                {mostrandoTodos || busca ? (
                  // EXIBIÇÃO DE PAGINAÇÃO quando em modo completo
                  <div className="flex items-center gap-4">
                    <span>
                      Página {paginaAtual} de {totalPaginas} 
                      {' '}({dadosExibicao.length} de {dadosFiltrados.length} registros)
                    </span>
                    
                    {/* Controles de paginação */}
                    {totalPaginas > 1 && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={voltarPagina}
                          disabled={paginaAtual === 1}
                          className="px-3 py-1 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Anterior
                        </button>
                        
                        <div className="flex gap-1">
                          {gerarBotoesPagina()}
                        </div>
                        
                        <button
                          onClick={avancarPagina}
                          disabled={paginaAtual === totalPaginas}
                          className="px-3 py-1 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Próxima
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  // Exibição inicial (5 registros)
                  <span>
                    Mostrando <span className="font-semibold">{dadosExibicao.length}</span> registros vigentes mais recentes
                    {busca && (
                      <span> para '<span className="font-semibold">{busca}</span>'</span>
                    )}
                  </span>
                )}
              </div>

              {/* BOTÕES DE AÇÃO */}
              <div className="flex gap-3">
                {/* Botão Exportar CSV - sempre visível quando há dados */}
                {(todosRegistros.length > 0) && (
                  <button
                    onClick={handleExportarCSV}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {getTextoExportacao()}
                  </button>
                )}

                {/* Botão "Ver mais" apenas na exibição inicial */}
                {!mostrandoTodos && !busca && (
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
        <div className="mt-8 text-center text-gray-500 text-sm">
          <p>
            Última atualização: {dataAtualizacao || 'Carregando...'}
          </p>
        </div>
      </div>
    </div>
  )
}