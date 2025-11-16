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
  { id: 'link_portaria_dou', nome: 'Link da Portaria Publicada no DOU' },
  { id: 'quantidade_retificado_dou', nome: 'Quantidade de Retificações da Portaria no DOU' },
  { id: 'ultimo_link_retificado_dou', nome: 'Última Retificação da Portaria Publicada no DOU' },
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

export default function ConsultaPortarias() {
  const [portarias, setPortarias] = useState<any[]>([])
  const [dadosFiltrados, setDadosFiltrados] = useState<any[]>([])
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

  // Buscar dados do Supabase
  useEffect(() => {
    const buscarDados = async () => {
      try {
        // Buscar TODOS os dados sem limite
        const { data, error } = await supabase
          .from('portarias_iphan')
          .select('*')
          .order('data_publicacao_dou', { ascending: false })

        if (error) {
          console.error('Erro:', error)
        } else {
          setPortarias(data || [])
          
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

  // Efeito para exibição automática inicial
  useEffect(() => {
    if (portarias.length === 0) return

    // Encontrar a data mais recente
    const datasUnicas = [...new Set(portarias.map(p => p.data_publicacao_dou).filter(Boolean))]
    const dataMaisRecente = datasUnicas.sort((a, b) => {
      // Converter dd/mm/aaaa para Date para ordenação
      const [diaA, mesA, anoA] = a.split('/').map(Number)
      const [diaB, mesB, anoB] = b.split('/').map(Number)
      return new Date(anoB, mesB - 1, diaB).getTime() - new Date(anoA, mesA - 1, diaA).getTime()
    })[0]

    // Filtrar apenas registros com a data mais recente E status Vigente
    const dadosIniciais = portarias.filter(portaria => {
      const status = calcularStatus(portaria)
      return portaria.data_publicacao_dou === dataMaisRecente && status === 'Vigente'
    })

    // Exibir apenas 5 registros na visualização inicial
    setDadosFiltrados(dadosIniciais.slice(0, 5))
    setMostrandoTodos(false)
  }, [portarias])

  // Função para calcular status - CORRIGIDA: Inclui status "Revogado"
  const calcularStatus = (portaria: any) => {
    // 🔧 NOVA CONDIÇÃO: Verificar se é Revogado
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

  // Busca dinâmica no Supabase - CORRIGIDA: case-insensitive e sem caracteres especiais
  const handleBusca = async (termo: string) => {
    setBusca(termo)
    
    if (!termo.trim()) {
      // Se busca vazia, voltar para exibição inicial automática (5 registros)
      const datasUnicas = [...new Set(portarias.map(p => p.data_publicacao_dou).filter(Boolean))]
      const dataMaisRecente = datasUnicas.sort((a, b) => {
        const [diaA, mesA, anoA] = a.split('/').map(Number)
        const [diaB, mesB, anoB] = b.split('/').map(Number)
        return new Date(anoB, mesB - 1, diaB).getTime() - new Date(anoA, mesA - 1, diaA).getTime()
      })[0]

      const dadosIniciais = portarias.filter(portaria => {
        const status = calcularStatus(portaria)
        return portaria.data_publicacao_dou === dataMaisRecente && status === 'Vigente'
      })

      setDadosFiltrados(dadosIniciais.slice(0, 5))
      setMostrandoTodos(false)
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
          portaria.tipo // 🔧 INCLUÍDO: campo tipo na busca
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
    } catch (err) {
      console.error('Erro na busca:', err)
    }
  }

  // Função para carregar mais registros
  const carregarMaisRegistros = () => {
    const datasUnicas = [...new Set(portarias.map(p => p.data_publicacao_dou).filter(Boolean))]
    const dataMaisRecente = datasUnicas.sort((a, b) => {
      const [diaA, mesA, anoA] = a.split('/').map(Number)
      const [diaB, mesB, anoB] = b.split('/').map(Number)
      return new Date(anoB, mesB - 1, diaB).getTime() - new Date(anoA, mesA - 1, diaA).getTime()
    })[0]

    const dadosIniciais = portarias.filter(portaria => {
      const status = calcularStatus(portaria)
      return portaria.data_publicacao_dou === dataMaisRecente && status === 'Vigente'
    })

    setDadosFiltrados(dadosIniciais)
    setMostrandoTodos(true)
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
        return 'bg-orange-100 text-orange-800' // 🔧 NOVA COR para Revogado
      default:
        return 'bg-gray-100 text-gray-800'
    }
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
              Colunas Visíveis:
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
                  {colunasSelecionadas.includes('status_portaria') && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                  )}
                  {todasColunas
                    .filter(coluna => colunasSelecionadas.includes(coluna.id))
                    .map(coluna => (
                      <th key={coluna.id} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {coluna.nome}
                      </th>
                    ))
                  }
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {dadosFiltrados.map((portaria) => (
                  <tr key={portaria.id} className="hover:bg-gray-50">
                    {colunasSelecionadas.includes('status_portaria') && (
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${obterClasseStatus(calcularStatus(portaria))}`}
                        >
                          {calcularStatus(portaria)}
                        </span>
                      </td>
                    )}
                    {todasColunas
                      .filter(coluna => colunasSelecionadas.includes(coluna.id))
                      .map(coluna => (
                        <td key={coluna.id} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {renderizarConteudoCelula(coluna.id, portaria[coluna.id] || 'N/A')}
                        </td>
                      ))
                    }
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Contador de resultados */}
          <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 flex justify-between items-center">
            <p className="text-sm text-gray-700">
              Mostrando <span className="font-semibold">{dadosFiltrados.length}</span> de{' '}
              <span className="font-semibold">{portarias.length}</span> registros
              {busca && (
                <span> para '<span className="font-semibold">{busca}</span>'</span>
              )}
            </p>
            
            {/* Botão "Ver mais" apenas na exibição inicial com 5 registros */}
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