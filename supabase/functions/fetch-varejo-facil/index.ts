// Função Serverless para buscar dados da API do Varejo Fácil
// Evita problemas de CORS ao fazer requisições do lado do servidor

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

interface VarejoFacilProduct {
  id?: string;
  codigo_barras: string;
  descricao: string;
  preco: number;
  estoque: number;
  [key: string]: any; // Para campos adicionais
}

interface ResponseData {
  success: boolean;
  data?: VarejoFacilProduct;
  error?: string;
}

serve(async (_req) => {
  const url = new URL(_req.url);
  const codigoBarras = url.searchParams.get("codigo");

  if (!codigoBarras) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Código de barras não fornecido"
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 400
      }
    );
  }

  try {
    // Usar o domínio correto do Varejo Fácil
    const apiUrl = `https://newshop.varejofacil.com/api/v1/produtos/${codigoBarras}`;

    // Buscar primeiro o produto pelo código de barras para obter o ID interno
    // Se não tiver endpoint direto, podemos usar uma estratégia diferente

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        // Adicione sua chave de API aqui:
        'Authorization': 'Bearer ' + Deno.env.get('VAREJOFACIL_API_KEY'),
        // ou outro header necessário, por exemplo:
        // 'X-API-Key': Deno.env.get('VAREJOFACIL_API_KEY'),
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Produto não encontrado"
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 404
          }
        );
      }

      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Normalizar dados para consistência
    const produto: VarejoFacilProduct = {
      id: data.id || data.produto_id || '',
      codigo_barras: data.codigo_barras || data.ean || data.gtin || codigoBarras,
      descricao: data.descricao || data.nome || data.titulo || '',
      preco: Number(data.preco || data.valor || data.price || 0),
      estoque: Number(data.estoque || data.quantidade || data.qtd || 0),
    };

    const responseData: ResponseData = {
      success: true,
      data: produto
    };

    return new Response(
      JSON.stringify(responseData),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*", // Permitir CORS
        }
      }
    );

  } catch (error) {
    console.error("Erro na função serverless:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: `Erro ao buscar produto: ${(error as Error).message}`
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 500
      }
    );
  }
});