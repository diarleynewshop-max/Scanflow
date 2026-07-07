import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Função para tentar contornar CORS fazendo requisições através de um proxy
 * Ou usando técnicas alternativas quando CORS bloqueia
 */
export const fetchWithProxy = async (url: string, options: RequestInit = {}) => {
  // Tentar acesso direto primeiro
  try {
    const response = await fetch(url, options);
    return response;
  } catch (directError) {
    console.log("Acesso direto falhou:", directError);
    // Se todos falharem, lançar o erro original
    throw directError;
  }
};

/**
 * Função para normalizar dados de produto de diferentes fontes
 */
export const normalizeProductData = (rawData: any, source: 'varejofacil' | 'supabase' | 'unknown'): any => {
  if (!rawData) return null;

  switch (source) {
    case 'varejofacil':
      return {
        id: rawData.id || rawData.produto_id,
        codigo_barras: rawData.codigo_barras || rawData.ean || rawData.gtin,
        descricao: rawData.descricao || rawData.nome || rawData.titulo,
        preco: Number(rawData.preco || rawData.valor || rawData.price || 0),
        estoque: Number(rawData.estoque || rawData.quantidade || rawData.qtd || 0),
      };

    case 'supabase':
      return {
        codigo: rawData.codigo || rawData.barcode,
        estoque: Number(rawData.estoque || rawData.quantidade_estoque || rawData.qtd || 0),
        preco: rawData.preco !== undefined ? Number(rawData.preco) :
               rawData.valor !== undefined ? Number(rawData.valor) : undefined,
        nome_produto: rawData.nome_produto || rawData.nome || rawData.descricao_produto,
        descricao: rawData.descricao || rawData.descricao_completa,
      };

    default:
      return rawData;
  }
};

/**
 * Validar se os dados do produto são válidos
 */
export const isValidProduct = (product: any): boolean => {
  if (!product) return false;

  // Verificar campos obrigatórios
  if (typeof product.codigo_barras === 'string' && product.codigo_barras.length > 0) {
    return true;
  }

  if (typeof product.codigo === 'string' && product.codigo.length > 0) {
    return true;
  }

  return false;
};
