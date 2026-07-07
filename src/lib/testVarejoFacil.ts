/**
 * Função para testar e explorar a API do Varejo Fácil
 * Esta função pode ser chamada manualmente para entender a estrutura da API
 */

// Função para testar o endpoint básico
export const testarEndpointBasico = async () => {
  try {
    console.log("Testando endpoint básico da API do Varejo Fácil...");

    // Tente diferentes variações de URL
    const urls = [
      "https://mercado.varejofacil.com/api/v1/produtos",
      "https://mercado.varejofacil.com/api/v1/products",
      "https://api.varejofacil.com/v1/produtos",
    ];

    for (const url of urls) {
      try {
        console.log(`Testando URL: ${url}`);
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          }
        });

        console.log(`Status: ${response.status}`);
        console.log(`Headers:`, [...response.headers.entries()]);

        if (response.ok) {
          const data = await response.json();
          console.log(`Dados recebidos de ${url}:`, data);
          return { url, data };
        }
      } catch (error) {
        console.log(`Falha ao testar ${url}:`, error);
      }
    }

    console.log("Todos os testes falharam");
    return null;
  } catch (error) {
    console.error("Erro ao testar endpoint básico:", error);
    return null;
  }
};

// Função para testar com um código de barras específico
export const testarComCodigoBarras = async (codigo: string) => {
  try {
    console.log(`Testando busca de produto com código: ${codigo}`);

    // Tente diferentes padrões de URL
    const urlPatterns = [
      `https://mercado.varejofacil.com/api/v1/produtos/${codigo}`,
      `https://mercado.varejofacil.com/api/v1/products/${codigo}`,
      `https://mercado.varejofacil.com/api/v1/produtos?codigo=${codigo}`,
      `https://mercado.varejofacil.com/api/v1/produtos?ean=${codigo}`,
    ];

    for (const url of urlPatterns) {
      try {
        console.log(`Testando URL: ${url}`);
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          }
        });

        console.log(`Status: ${response.status}`);

        if (response.ok) {
          const contentType = response.headers.get('content-type');
          console.log(`Content-Type: ${contentType}`);

          if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            console.log(`Dados recebidos de ${url}:`, data);
            return { url, data };
          } else {
            const text = await response.text();
            console.log(`Resposta não-JSON de ${url}:`, text);
            return { url, data: text };
          }
        } else {
          console.log(`Erro ${response.status}: ${response.statusText}`);
          const text = await response.text();
          console.log(`Corpo do erro:`, text);
        }
      } catch (error) {
        console.log(`Falha ao testar ${url}:`, error);
      }
    }

    console.log("Todos os testes com código de barras falharam");
    return null;
  } catch (error) {
    console.error("Erro ao testar com código de barras:", error);
    return null;
  }
};

// Função para descobrir endpoints disponíveis
export const descobrirEndpoints = async () => {
  try {
    console.log("Tentando descobrir endpoints disponíveis...");

    // Verificar se há documentação em formatos comuns
    const docUrls = [
      "https://mercado.varejofacil.com/api/v1/docs",
      "https://mercado.varejofacil.com/api/v1/swagger.json",
      "https://mercado.varejofacil.com/api/v1/openapi.json",
      "https://mercado.varejofacil.com/swagger.json",
      "https://mercado.varejofacil.com/docs",
    ];

    for (const url of docUrls) {
      try {
        console.log(`Verificando documentação em: ${url}`);
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          }
        });

        if (response.ok) {
          const contentType = response.headers.get('content-type');
          if (contentType && (contentType.includes('application/json') || contentType.includes('text/html'))) {
            console.log(`Documentação encontrada em: ${url}`);
            if (contentType.includes('application/json')) {
              const data = await response.json();
              console.log(`Conteúdo da documentação:`, data);
              return { url, data };
            } else {
              const text = await response.text();
              console.log(`Documentação HTML:`, text.substring(0, 500) + "...");
              return { url, data: text };
            }
          }
        }
      } catch (error) {
        console.log(`Falha ao verificar ${url}:`, error);
      }
    }

    console.log("Não foi possível encontrar documentação");
    return null;
  } catch (error) {
    console.error("Erro ao descobrir endpoints:", error);
    return null;
  }
};

// Exportar todas as funções juntas
export const testAll = async () => {
  console.log("=== INICIANDO TESTES DA API VAREJO FÁCIL ===");

  // Testar documentação primeiro
  await descobrirEndpoints();

  // Testar endpoint básico
  await testarEndpointBasico();

  console.log("=== FIM DOS TESTES ===");
};