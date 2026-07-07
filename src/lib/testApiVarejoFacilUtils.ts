/*
 * Utilitário para testar a API do Varejo Fácil
 *
 * Para usar:
 * 1. Importe esta função no seu componente
 * 2. Chame testarApiVarejoFacil() para iniciar os testes
 * 3. Verifique o console do navegador para ver os resultados
 */

/**
 * Testa diferentes URLs da API do Varejo Fácil
 */
export const testarApiVarejoFacil = async () => {
  console.log("=== INICIANDO TESTES DA API VAREJO FÁCIL ===");

  // URLs para testar
  const urls = [
    "https://mercado.varejofacil.com/api/v1/docs",
    "https://mercado.varejofacil.com/api/v1/produtos",
    "https://mercado.varejofacil.com/api/v1/products",
    "https://mercado.varejofacil.com/swagger.json",
  ];

  // Testar cada URL
  for (const url of urls) {
    try {
      console.log(`Testando: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        }
      });

      console.log(`Status: ${response.status} ${response.statusText}`);

      // Verificar tipo de conteúdo
      const contentType = response.headers.get('content-type');
      console.log(`Content-Type: ${contentType}`);

      if (response.ok) {
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          console.log(`Dados (${url}):`, JSON.stringify(data, null, 2).substring(0, 1000) + "...");
        } else {
          const text = await response.text();
          console.log(`Texto (${url}):`, text.substring(0, 500) + "...");
        }
      } else {
        const errorText = await response.text();
        console.log(`Erro (${url}):`, errorText);
      }

    } catch (error) {
      console.log(`Falha ao testar ${url}:`, error);
    }

    console.log("---");
  }

  console.log("=== FIM DOS TESTES ===");
};

/**
 * Testa busca de produto específico
 */
export const testarProdutoEspecifico = async (codigo: string) => {
  console.log(`=== TESTANDO PRODUTO: ${codigo} ===`);

  const urls = [
    `https://mercado.varejofacil.com/api/v1/produtos/${codigo}`,
    `https://mercado.varejofacil.com/api/v1/products/${codigo}`,
    `https://mercado.varejofacil.com/api/v1/produtos?codigo=${codigo}`,
    `https://mercado.varejofacil.com/api/v1/produtos?ean=${codigo}`,
  ];

  for (const url of urls) {
    try {
      console.log(`Testando: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        }
      });

      console.log(`Status: ${response.status} ${response.statusText}`);

      if (response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          console.log(`Dados:`, JSON.stringify(data, null, 2));
        } else {
          const text = await response.text();
          console.log(`Texto:`, text);
        }
      } else {
        const errorText = await response.text();
        console.log(`Erro:`, errorText);
      }

    } catch (error) {
      console.log(`Falha ao testar ${url}:`, error);
    }

    console.log("---");
  }

  console.log("=== FIM DO TESTE DE PRODUTO ===");
};