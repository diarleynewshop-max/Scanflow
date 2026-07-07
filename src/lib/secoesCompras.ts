// Lista fixa de secoes por empresa, usada tanto na configuracao do perfil de
// Compras (marcar as secoes do comprador) quanto no filtro da tela de Compras.
// As secoes reais vem do ERP conforme os produtos carregam; esta lista fixa e a
// unica fonte estatica disponivel no momento em que o comprador ainda nao tem
// produtos em tela (ex.: configurar o perfil).

export const SECOES_FIXAS_NEWSHOP = ["Eletronico", "Papelaria", "Bijuteria"];

export const SECOES_FIXAS_SF = [
  "GERAL",
  "PET SHOP",
  "UTILIDADES DOMÉSTICAS",
  "PAPELARIA",
  "ÁREA KIDS",
  "ELETRÔNICOS E INFORMÁTICA",
  "USO PESSOAL",
  "AUTOMOTIVO",
  "ESPORTE E LAZER",
  "CONSUMO",
];

export function getSecoesFixasPorEmpresa(empresa: string): string[] {
  const empresaNormalizada = empresa.toUpperCase();
  if (empresaNormalizada.includes("FACIL") || empresaNormalizada.includes("SOYE")) {
    return SECOES_FIXAS_SF;
  }

  return SECOES_FIXAS_NEWSHOP;
}
