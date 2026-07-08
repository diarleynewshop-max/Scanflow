export type PeriodoFiltro = "total" | "7" | "15" | "30" | "intervalo";

export const PERIODO_OPCOES: Array<{ value: PeriodoFiltro; label: string }> = [
  { value: "total", label: "Total" },
  { value: "7", label: "7 dias" },
  { value: "15", label: "15 dias" },
  { value: "30", label: "30 dias" },
  { value: "intervalo", label: "Intervalo" },
];

export function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolverDatasPeriodo(
  periodo: PeriodoFiltro,
  dataInicio: string,
  dataFim: string
): { dataInicio?: string; dataFim?: string } {
  if (periodo === "intervalo") {
    return {
      dataInicio: dataInicio || undefined,
      dataFim: dataFim || undefined,
    };
  }

  if (periodo === "total") return {};

  const dias = Number(periodo);
  if (!Number.isFinite(dias) || dias <= 0) return {};

  const data = new Date();
  data.setDate(data.getDate() - dias);
  return { dataInicio: formatDateInputValue(data) };
}
