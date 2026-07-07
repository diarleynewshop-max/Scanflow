-- Migration: 001_create_analytics_tables.sql
-- Criação das tabelas para analytics no Supabase
-- Data: 2026-04-07

-- ============================================================================
-- TABELA 1: lista_baixada_logs
-- Armazena todos os pedidos enviados para ClickUp (TASK 1)
-- ============================================================================

CREATE TABLE IF NOT EXISTS lista_baixada_logs (
  -- Identificação
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Metadata do payload
  flag TEXT NOT NULL CHECK (flag IN ('loja')),  -- Atualmente só "loja" é suportado
  empresa TEXT NOT NULL CHECK (empresa IN ('NEWSHOP', 'SOYE', 'FACIL')),
  pessoa TEXT NOT NULL,
  titulo TEXT NOT NULL,
  total_itens INTEGER NOT NULL CHECK (total_itens >= 0),
  data_criacao TIMESTAMP WITH TIME ZONE NOT NULL,
  data_download TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- IDs das tarefas no ClickUp
  clickup_task_id TEXT,
  clickup_compras_task_id TEXT,
  
  -- Status do processamento
  processing_time_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'error')),
  error_message TEXT,
  
  -- Analytics
  produtos_count INTEGER NOT NULL DEFAULT 0,
  produtos_sem_estoque_count INTEGER NOT NULL DEFAULT 0,
  fotos_count INTEGER NOT NULL DEFAULT 0,
  
  -- Payload original (para debugging)
  payload_json JSONB NOT NULL,
  
  -- Índices para performance
  CONSTRAINT fk_empresa CHECK (empresa IN ('NEWSHOP', 'SOYE', 'FACIL'))
);

-- Índices para queries rápidas
CREATE INDEX IF NOT EXISTS idx_lista_baixada_created_at ON lista_baixada_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lista_baixada_empresa ON lista_baixada_logs(empresa);
CREATE INDEX IF NOT EXISTS idx_lista_baixada_pessoa ON lista_baixada_logs(pessoa);
CREATE INDEX IF NOT EXISTS idx_lista_baixada_status ON lista_baixada_logs(status);
CREATE INDEX IF NOT EXISTS idx_lista_baixada_clickup_task ON lista_baixada_logs(clickup_task_id);

-- ============================================================================
-- TABELA 2: conferencia_baixada_logs
-- Armazena todas as conferências completadas (TASK 2)
-- ============================================================================

CREATE TABLE IF NOT EXISTS conferencia_baixada_logs (
  -- Identificação
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Metadata do payload
  conferente TEXT NOT NULL,
  tempo TEXT NOT NULL,  -- Formato "HH:MM:SS"
  tempo_segundos INTEGER,  -- Tempo convertido para segundos para analytics
  total_itens INTEGER NOT NULL CHECK (total_itens >= 0),
  empresa TEXT NOT NULL CHECK (empresa IN ('NEWSHOP', 'SOYE', 'FACIL')),
  flag TEXT NOT NULL CHECK (flag IN ('loja')),
  conference_id TEXT NOT NULL,
  data_conferencia TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Resumo (contagens)
  resumo_separado INTEGER NOT NULL DEFAULT 0,
  resumo_nao_tem INTEGER NOT NULL DEFAULT 0,
  resumo_parcial INTEGER NOT NULL DEFAULT 0,
  resumo_pendente INTEGER NOT NULL DEFAULT 0,
  
  -- IDs das tarefas no ClickUp
  clickup_task_id TEXT,
  clickup_compras_task_id TEXT,
  
  -- Status do processamento
  processing_time_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'error')),
  error_message TEXT,
  
  -- Analytics para rankings
  itens_faltantes_count INTEGER NOT NULL DEFAULT 0,  -- nao_tem + parcial
  fotos_faltantes_count INTEGER NOT NULL DEFAULT 0,
  digito_s_count INTEGER NOT NULL DEFAULT 0,
  digito_m_count INTEGER NOT NULL DEFAULT 0,
  itens_separados_count INTEGER NOT NULL DEFAULT 0,  -- separado + parcial (exclui negativos)
  
  -- Payload original (para debugging)
  payload_json JSONB NOT NULL,
  
  -- Índices para performance
  CONSTRAINT fk_empresa_conferencia CHECK (empresa IN ('NEWSHOP', 'SOYE', 'FACIL'))
);

-- Índices para queries rápidas
CREATE INDEX IF NOT EXISTS idx_conferencia_created_at ON conferencia_baixada_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conferencia_empresa ON conferencia_baixada_logs(empresa);
CREATE INDEX IF NOT EXISTS idx_conferencia_conferente ON conferencia_baixada_logs(conferente);
CREATE INDEX IF NOT EXISTS idx_conferencia_status ON conferencia_baixada_logs(status);
CREATE INDEX IF NOT EXISTS idx_conferencia_clickup_task ON conferencia_baixada_logs(clickup_task_id);
CREATE INDEX IF NOT EXISTS idx_conferencia_data ON conferencia_baixada_logs(data_conferencia DESC);

-- ============================================================================
-- TABELA 3: conferencia_itens
-- Armazena detalhes de cada item das conferências para análise granular
-- ============================================================================

CREATE TABLE IF NOT EXISTS conferencia_itens (
  -- Identificação
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  conferencia_log_id UUID NOT NULL REFERENCES conferencia_baixada_logs(id) ON DELETE CASCADE,
  
  -- Detalhes do item
  codigo TEXT NOT NULL,  -- Barcode
  sku TEXT,
  quantidade_pedida INTEGER NOT NULL CHECK (quantidade_pedida >= 0),
  quantidade_real INTEGER,
  status TEXT NOT NULL CHECK (status IN ('separado', 'nao_tem', 'nao_tem_tudo', 'pendente')),
  digito TEXT CHECK (digito IN ('S', 'M')),
  tem_foto BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Analytics
  diferenca_quantidade INTEGER,  -- quantidade_pedida - quantidade_real (para parcial)
  
  -- Índices para performance
  CONSTRAINT fk_conferencia_log FOREIGN KEY (conferencia_log_id) REFERENCES conferencia_baixada_logs(id) ON DELETE CASCADE
);

-- Índices para queries rápidas
CREATE INDEX IF NOT EXISTS idx_conferencia_itens_log_id ON conferencia_itens(conferencia_log_id);
CREATE INDEX IF NOT EXISTS idx_conferencia_itens_codigo ON conferencia_itens(codigo);
CREATE INDEX IF NOT EXISTS idx_conferencia_itens_status ON conferencia_itens(status);
CREATE INDEX IF NOT EXISTS idx_conferencia_itens_digito ON conferencia_itens(digito);

-- ============================================================================
-- VIEWS para queries comuns
-- ============================================================================

-- View para ranking de conferentes
CREATE OR REPLACE VIEW conferente_ranking AS
SELECT 
  conferente,
  COUNT(*) as total_conferencias,
  SUM(itens_separados_count) as total_itens_separados,
  AVG(tempo_segundos) as tempo_medio_segundos,
  CASE 
    WHEN SUM(tempo_segundos) > 0 
    THEN SUM(itens_separados_count)::FLOAT / SUM(tempo_segundos)::FLOAT
    ELSE 0 
  END as eficiencia_itens_por_segundo,
  MIN(data_conferencia) as primeira_conferencia,
  MAX(data_conferencia) as ultima_conferencia
FROM conferencia_baixada_logs
WHERE status = 'success'
GROUP BY conferente
ORDER BY total_itens_separados DESC;

-- View para análise de itens mais/menos pedidos
CREATE OR REPLACE VIEW item_popularidade AS
SELECT 
  codigo,
  COUNT(*) as vezes_pedido,
  SUM(quantidade_pedida) as quantidade_total_pedida,
  AVG(quantidade_pedida) as media_quantidade_pedida,
  COUNT(CASE WHEN status = 'separado' THEN 1 END) as vezes_separado,
  COUNT(CASE WHEN status = 'nao_tem' THEN 1 END) as vezes_nao_tem,
  COUNT(CASE WHEN status = 'nao_tem_tudo' THEN 1 END) as vezes_parcial,
  COUNT(CASE WHEN status = 'pendente' THEN 1 END) as vezes_pendente
FROM conferencia_itens
GROUP BY codigo
ORDER BY vezes_pedido DESC;

-- View para tempo médio por item
CREATE OR REPLACE VIEW tempo_medio_analise AS
SELECT 
  empresa,
  AVG(tempo_segundos::FLOAT / total_itens::FLOAT) as tempo_medio_por_item_segundos,
  AVG(tempo_segundos) as tempo_medio_total_segundos,
  AVG(total_itens) as media_itens_por_conferencia,
  COUNT(*) as total_conferencias
FROM conferencia_baixada_logs
WHERE status = 'success' AND total_itens > 0
GROUP BY empresa;

-- ============================================================================
-- FUNÇÕES UTILITÁRIAS
-- ============================================================================

-- Função para converter tempo "HH:MM:SS" para segundos
CREATE OR REPLACE FUNCTION tempo_para_segundos(tempo_text TEXT)
RETURNS INTEGER AS $$
DECLARE
  horas INTEGER;
  minutos INTEGER;
  segundos INTEGER;
BEGIN
  -- Extrai horas, minutos e segundos do formato "HH:MM:SS"
  horas := CAST(SPLIT_PART(tempo_text, ':', 1) AS INTEGER);
  minutos := CAST(SPLIT_PART(tempo_text, ':', 2) AS INTEGER);
  segundos := CAST(SPLIT_PART(tempo_text, ':', 3) AS INTEGER);
  
  RETURN (horas * 3600) + (minutos * 60) + segundos;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger para calcular tempo_segundos automaticamente
CREATE OR REPLACE FUNCTION calcular_tempo_segundos()
RETURNS TRIGGER AS $$
BEGIN
  NEW.tempo_segundos := tempo_para_segundos(NEW.tempo);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_calcular_tempo_segundos
BEFORE INSERT OR UPDATE ON conferencia_baixada_logs
FOR EACH ROW
EXECUTE FUNCTION calcular_tempo_segundos();

-- Trigger para calcular itens_separados_count automaticamente
CREATE OR REPLACE FUNCTION calcular_itens_separados()
RETURNS TRIGGER AS $$
BEGIN
  NEW.itens_separados_count := NEW.resumo_separado + NEW.resumo_parcial;
  NEW.itens_faltantes_count := NEW.resumo_nao_tem + NEW.resumo_parcial;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_calcular_itens_separados
BEFORE INSERT OR UPDATE ON conferencia_baixada_logs
FOR EACH ROW
EXECUTE FUNCTION calcular_itens_separados();

-- ============================================================================
-- COMENTÁRIOS DAS TABELAS
-- ============================================================================

COMMENT ON TABLE lista_baixada_logs IS 'Registra todos os pedidos enviados para ClickUp (TASK 1) para analytics';
COMMENT ON TABLE conferencia_baixada_logs IS 'Registra todas as conferências completadas (TASK 2) para rankings e analytics';
COMMENT ON TABLE conferencia_itens IS 'Detalhes de cada item das conferências para análise granular';

COMMENT ON VIEW conferente_ranking IS 'Ranking de conferentes por eficiência e volume';
COMMENT ON VIEW item_popularidade IS 'Análise de popularidade de itens (mais/menos pedidos)';
COMMENT ON VIEW tempo_medio_analise IS 'Análise de tempo médio por item e por conferência';