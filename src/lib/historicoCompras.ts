export const HISTORICO_COMPRAS_KEY = "scan_newshop_historico_compras";

export function getHistoricoComprasEnabled(): boolean {
  try {
    const val = localStorage.getItem(HISTORICO_COMPRAS_KEY);
    // habilitado por padrão; desliga só se explicitamente "false"
    return val !== "false";
  } catch {
    return true;
  }
}
