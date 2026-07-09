import { useEffect, useMemo, useState } from "react";
import { PackageCheck, RefreshCw, X } from "lucide-react";
import {
  listarPendentesConsolidados,
  type PendenteConsolidado,
} from "@/lib/pedidosFila";

interface EditarPendentesModalProps {
  open: boolean;
  onClose: () => void;
  empresa: string;
  flag: string;
}

function formatarDia(value: string | null): string {
  if (!value) return "-";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(date);
}

export function EditarPendentesModal({
  open,
  onClose,
  empresa,
  flag,
}: EditarPendentesModalProps) {
  const [itens, setItens] = useState<PendenteConsolidado[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const carregar = async (silent = false) => {
    if (!open) return;

    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await listarPendentesConsolidados(empresa, flag);
      setItens(data);
      setError(null);
    } catch (err) {
      console.error("[EditarPendentesModal] Falha ao carregar:", err);
      setError("Nao foi possivel carregar os pendentes agora.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, empresa, flag]);

  const resumo = useMemo(() => ({
    produtos: itens.length,
    unidades: itens.reduce((acc, item) => acc + item.quantidadePendente, 0),
  }), [itens]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[calc(100vh-2rem)] overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
              Editar Pendentes
            </p>
            <h2 className="mt-1 text-xl font-bold text-gray-900">
              Pendentes consolidados
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {empresa} | {flag.toUpperCase()} | {resumo.produtos} produto(s) | {resumo.unidades} un.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void carregar(true)}
              disabled={loading || refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Atualizar
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition hover:bg-gray-200"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="max-h-[calc(100vh-10rem)] overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {loading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="rounded-2xl border border-gray-200 p-4">
                  <div className="h-4 w-40 animate-pulse rounded bg-gray-200" />
                  <div className="mt-3 h-4 w-full animate-pulse rounded bg-gray-100" />
                  <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-gray-100" />
                </div>
              ))}
            </div>
          ) : itens.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 px-6 py-12 text-center text-gray-500">
              <PackageCheck className="mx-auto h-10 w-10 text-gray-400" />
              <p className="mt-4 text-base font-semibold text-gray-700">
                Nenhum pendente consolidado
              </p>
              <p className="mt-2 text-sm">
                Os itens que ja foram tratados em pedido posterior saem desta lista automaticamente.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {itens.map((item) => (
                <article key={item.produtoKey} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-start gap-3">
                    {item.photo ? (
                      <img
                        src={item.photo}
                        alt={item.descricao}
                        className="h-16 w-16 rounded-xl object-cover bg-white"
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-white text-xs text-gray-400">
                        sem foto
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-sm font-bold text-gray-900">
                        {item.descricao}
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-gray-500">
                        {item.codigo}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-indigo-100 px-2 py-1 font-semibold text-indigo-700">
                          {item.quantidadePendente} un.
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                          {item.ocorrencias} ocorrencia(s)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-1 text-xs text-gray-600">
                    <div>SKU: {item.sku || "-"}</div>
                    <div>Secao: {item.secao || "-"}</div>
                    <div>Ultimo dia pendente: {formatarDia(item.ultimaData)}</div>
                    <div className="line-clamp-2">
                      Pedidos: {item.pedidoTitulos.length > 0 ? item.pedidoTitulos.join(" | ") : "-"}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
