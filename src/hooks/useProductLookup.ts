import { useState, useCallback, useEffect } from "react";
import { buscarProdutoVarejoFacil, type VarejoFacilLookupContext } from "@/lib/varejoFacilIntegration";

interface ProductInfo {
  codigo: string;
  estoque: number;
  preco?: number;
  precoVarejo?: number;
  precoAtacado?: number;
  nome_produto?: string;
  descricao?: string;
  secao?: string;
  imagem?: string;
  hasErpImage?: boolean;
  erpProdutoId?: string;
}

interface UseProductLookupReturn {
  productInfo: ProductInfo | null;
  loading: boolean;
  error: string | null;
  lookupProduct: (barcode: string) => Promise<void>;
}

interface UseProductLookupOptions {
  enabled?: boolean;
  empresa?: string | null;
  flag?: string | null;
}

export const useProductLookup = ({ enabled = true, empresa, flag }: UseProductLookupOptions = {}): UseProductLookupReturn => {
  const [productInfo, setProductInfo] = useState<ProductInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (enabled) return;
    setProductInfo(null);
    setError(null);
    setLoading(false);
  }, [enabled]);

  const lookupProduct = useCallback(async (barcode: string) => {
    if (!enabled) {
      setProductInfo(null);
      setError(null);
      setLoading(false);
      return;
    }

    console.log("Buscando produto com codigo:", barcode);
    setLoading(true);
    setError(null);

    try {
      // Produto vem direto da API Varejo Facil da empresa ativa.
      const contexto: VarejoFacilLookupContext = { empresa, flag };
      const produtoVarejoFacil = await buscarProdutoVarejoFacil(barcode, contexto);

      if (produtoVarejoFacil) {
        const productData: ProductInfo = {
          codigo: produtoVarejoFacil.codigo_barras,
          estoque: produtoVarejoFacil.estoque,
          preco: produtoVarejoFacil.preco,
          precoVarejo: produtoVarejoFacil.precoVarejo,
          precoAtacado: produtoVarejoFacil.precoAtacado,
          nome_produto: produtoVarejoFacil.descricao,
          secao: produtoVarejoFacil.secao,
          imagem: produtoVarejoFacil.imagem,
          hasErpImage: produtoVarejoFacil.hasErpImage,
          erpProdutoId: produtoVarejoFacil.id,
        };

        setProductInfo(productData);
      } else {
        setError("Produto nao encontrado na API Varejo Facil");
        setProductInfo(null);
      }
    } catch (err: any) {
      console.error("Erro ao buscar produto:", err);
      setError(err.message || "Falha ao buscar informacoes do produto");
      setProductInfo(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, empresa, flag]);

  return { productInfo, loading, error, lookupProduct };
};
