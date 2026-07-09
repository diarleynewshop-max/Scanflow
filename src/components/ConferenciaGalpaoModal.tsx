import { Loader2, PackageCheck, RefreshCw, X } from "lucide-react";

export interface ConferenciaGalpaoItemView {
  id: string;
  codigo: string;
  descricao: string;
  secao: string | null;
  photo: string | null;
  status: string;
  vezesPedido: number;
}

interface ConferenciaGalpaoModalProps {
  open: boolean;
  onClose: () => void;
  itemAtual: ConferenciaGalpaoItemView | null;
  totalFiltrados: number;
  totalBase: number;
  filtroSecao: string;
  onFiltroSecaoChange: (value: string) => void;
  secoesDisponiveis: string[];
  temSecoesCompras: boolean;
  minhasSecoesValue: string;
  minhasSecoesCount: number;
  carregandoFiltroSecao: boolean;
  acaoEmAndamento: boolean;
  onTem: () => void;
  onNaoTem: () => void;
}

function getStatusLabel(status: string): string {
  if (status === "todo") return "Pendente";
  if (status === "fazer_pedido") return "Fazer Pedido";
  return status;
}

export function ConferenciaGalpaoModal({
  open,
  onClose,
  itemAtual,
  totalFiltrados,
  totalBase,
  filtroSecao,
  onFiltroSecaoChange,
  secoesDisponiveis,
  temSecoesCompras,
  minhasSecoesValue,
  minhasSecoesCount,
  carregandoFiltroSecao,
  acaoEmAndamento,
  onTem,
  onNaoTem,
}: ConferenciaGalpaoModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
              Conferencia Galpao
            </p>
            <h2 className="mt-1 text-xl font-bold text-gray-900">
              Segunda revisao antes do fornecedor
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {totalFiltrados} de {totalBase} item(ns) em Compras
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition hover:bg-gray-200"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
              Secao
            </label>
            <select
              value={filtroSecao}
              onChange={(event) => onFiltroSecaoChange(event.target.value)}
              className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              {temSecoesCompras && (
                <option value={minhasSecoesValue}>
                  Minhas secoes ({minhasSecoesCount})
                </option>
              )}
              <option value="todos">Todas as secoes</option>
              {secoesDisponiveis.map((secao) => (
                <option key={secao} value={secao}>
                  {secao}
                </option>
              ))}
            </select>
            {carregandoFiltroSecao && (
              <div className="mt-2 inline-flex items-center gap-2 text-xs text-gray-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                Carregando secoes
              </div>
            )}
          </div>

          {!itemAtual && carregandoFiltroSecao ? (
            <div className="py-16 flex items-center justify-center gap-2 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Carregando itens
            </div>
          ) : !itemAtual ? (
            <div className="rounded-2xl border border-dashed border-gray-200 px-6 py-12 text-center text-gray-500">
              <PackageCheck className="mx-auto h-10 w-10 text-gray-400" />
              <p className="mt-4 text-base font-semibold text-gray-700">
                Nenhum item nesta fila
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-2xl border border-gray-200">
                {itemAtual.photo ? (
                  <img
                    src={itemAtual.photo}
                    alt={itemAtual.descricao}
                    className="h-72 w-full object-contain bg-gray-100"
                  />
                ) : (
                  <div className="flex h-72 items-center justify-center bg-gray-100 text-sm text-gray-400">
                    sem foto
                  </div>
                )}

                <div className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs font-semibold text-indigo-700">
                      {getStatusLabel(itemAtual.status)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                      {itemAtual.vezesPedido}x pedido(s)
                    </span>
                  </div>

                  <div className="text-lg font-bold text-gray-900">
                    {itemAtual.descricao}
                  </div>
                  <div className="font-mono text-xs text-gray-500">{itemAtual.codigo}</div>
                  <div className="text-sm text-gray-600">
                    Secao: {itemAtual.secao || "-"}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={onTem}
                  disabled={acaoEmAndamento}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {acaoEmAndamento ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                  TEM
                </button>
                <button
                  type="button"
                  onClick={onNaoTem}
                  disabled={acaoEmAndamento}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {acaoEmAndamento ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  NAO TEM
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
