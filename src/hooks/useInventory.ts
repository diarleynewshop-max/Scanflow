import { useState, useCallback, useEffect, useRef } from "react";
import { Product, ListData, ListFlag } from "@/components/ProductCard";
import { useToast } from "@/hooks/use-toast";
import {
  dataUrlToBlob,
  isDataPhotoUrl,
  isObjectPhotoUrl,
  revokePhotoUrl,
  shouldPersistPhoto,
  stripPhotoForPersistence,
} from "@/lib/photoUtils";
import { deletePhotoBlob, getPhotoBlob, putPhotoBlob } from "@/lib/photoStore";

interface OpenListParams {
  title: string;
  person: string;
  flag: ListFlag;
  empresa: string;
}

interface AddProductParams {
  barcode: string;
  sku: string;
  photo?: string | null;
  quantity: number;
  removeTag?: boolean;
  description?: string;
  secao?: string;
  erpProdutoId?: string;
  erpPhotoMissing?: boolean;
  appPhotoWithoutErp?: boolean;
  importedFromSpreadsheet?: boolean;
  qtdPlanilha?: number;
}

const STORAGE_KEY = "scan_newshop_lists";

type SaveListsResult = "ok" | "without-photos" | "failed";

type PreparedPhoto = Pick<Product, "photo" | "photoBlob" | "photoAssetId">;

function createPhotoAssetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function preparePhotoForRuntime(photo: string | null | undefined): Promise<PreparedPhoto> {
  if (!photo) {
    return { photo: null, photoBlob: null, photoAssetId: null };
  }

  if (!isDataPhotoUrl(photo)) {
    return { photo, photoBlob: null, photoAssetId: null };
  }

  const blob = dataUrlToBlob(photo);
  const photoAssetId = createPhotoAssetId();
  await putPhotoBlob(photoAssetId, blob);

  return {
    photo: URL.createObjectURL(blob),
    photoBlob: blob,
    photoAssetId,
  };
}

function cleanupProductPhoto(product: Product | undefined): void {
  if (!product) return;

  if (product.photoAssetId) {
    void deletePhotoBlob(product.photoAssetId).catch((error) => {
      console.error("Erro ao remover foto persistida:", error);
    });
  }

  if (isObjectPhotoUrl(product.photo)) {
    revokePhotoUrl(product.photo);
  }
}

function stripPhotosFromLists(lists: ListData[]): ListData[] {
  return lists.map((list) => ({
    ...list,
    products: list.products.map((product) => stripPhotoForPersistence(product)),
  }));
}

function hasNonPersistablePhotos(lists: ListData[]): boolean {
  return lists.some((list) =>
    list.products.some(
      (product) =>
        Boolean(product.photo) &&
        !product.photoAssetId &&
        !shouldPersistPhoto(product)
    )
  );
}

function saveLists(lists: ListData[]): SaveListsResult {
  const serializableLists = stripPhotosFromLists(lists);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializableLists));
    return hasNonPersistablePhotos(lists) ? "without-photos" : "ok";
  } catch (err) {
    console.error("Erro ao salvar listas:", err);
  }

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        serializableLists.map((list) => ({
          ...list,
          products: list.products.map((product) => ({
            ...product,
            photo: null,
          })),
        }))
      )
    );
    return "without-photos";
  } catch (fallbackErr) {
    console.error("Erro ao salvar listas sem fotos:", fallbackErr);
    return "failed";
  }
}

function loadLists(): ListData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as ListData[];
    return parsed.map((list) => ({
      ...list,
      flag: list.flag ?? "loja",
      empresa: list.empresa ?? "",
      createdAt: new Date(list.createdAt),
      closedAt: list.closedAt ? new Date(list.closedAt) : undefined,
      products: list.products.map((product) => ({
        ...product,
        photoAssetId: product.photoAssetId ?? null,
        photoBlob: null,
        erpPhotoMissing: false,
        appPhotoWithoutErp: false,
        createdAt: new Date(product.createdAt),
      })),
    }));
  } catch {
    return [];
  }
}

export function useInventory() {
  const { toast } = useToast();
  const [lists, setLists] = useState<ListData[]>(() => loadLists());
  const lastSaveResultRef = useRef<SaveListsResult>("ok");
  const [activeListId, setActiveListId] = useState<string | null>(() => {
    try {
      const savedId = localStorage.getItem("scan_newshop_active_list");
      if (!savedId) return null;
      const loadedLists = loadLists();
      const exists = loadedLists.find((list) => list.id === savedId && list.status === "open");
      return exists ? savedId : null;
    } catch {
      return null;
    }
  });

  const activeList = lists.find((list) => list.id === activeListId && list.status === "open") ?? null;

  useEffect(() => {
    const saveResult = saveLists(lists);

    if (saveResult !== lastSaveResultRef.current) {
      if (saveResult === "failed") {
        toast({
          title: "Falha ao salvar localmente",
          description: "O app nao conseguiu persistir tudo no aparelho. Feche listas pesadas ou limpe fotos.",
          variant: "destructive",
        });
      }
    }

    lastSaveResultRef.current = saveResult;

    if (activeListId) {
      localStorage.setItem("scan_newshop_active_list", activeListId);
    } else {
      localStorage.removeItem("scan_newshop_active_list");
    }
  }, [lists, activeListId, toast]);

  useEffect(() => {
    let cancelled = false;

    const hydratePersistedPhotos = async () => {
      const pendingAssetProducts = lists.flatMap((list) =>
        list.products
          .filter((product) => product.photoAssetId && !product.photo)
          .map((product) => ({
            productId: product.id,
            photoAssetId: product.photoAssetId as string,
          }))
      );
      const pendingDataUrlProducts = lists.flatMap((list) =>
        list.products
          .filter((product) => isDataPhotoUrl(product.photo))
          .map((product) => ({
            productId: product.id,
            photo: product.photo as string,
          }))
      );

      if (pendingAssetProducts.length === 0 && pendingDataUrlProducts.length === 0) return;

      const hydratedPhotos = await Promise.all(
        pendingAssetProducts.map(async (product) => ({
          productId: product.productId,
          blob: await getPhotoBlob(product.photoAssetId).catch(() => null),
        }))
      );
      const migratedPhotos = await Promise.all(
        pendingDataUrlProducts.map(async (product) => ({
          productId: product.productId,
          photo: await preparePhotoForRuntime(product.photo).catch(() => null),
        }))
      );

      if (cancelled) return;

      const hydratedMap = new Map(
        hydratedPhotos
          .filter((item): item is { productId: string; blob: Blob } => item.blob instanceof Blob)
          .map((item) => [item.productId, item.blob])
      );
      const migratedMap = new Map(
        migratedPhotos
          .filter((item): item is { productId: string; photo: PreparedPhoto } => Boolean(item.photo))
          .map((item) => [item.productId, item.photo])
      );

      if (hydratedMap.size === 0 && migratedMap.size === 0) return;

      setLists((prev) =>
        prev.map((list) => {
          let changed = false;

          const products = list.products.map((product) => {
            const migratedPhoto = migratedMap.get(product.id);
            if (migratedPhoto) {
              changed = true;
              return {
                ...product,
                ...migratedPhoto,
              };
            }

            if (product.photo || !product.photoAssetId) {
              return product;
            }

            const blob = hydratedMap.get(product.id);
            if (!blob) {
              return product;
            }

            changed = true;
            if (isObjectPhotoUrl(product.photo)) revokePhotoUrl(product.photo);
            return {
              ...product,
              photo: URL.createObjectURL(blob),
              photoBlob: blob,
            };
          });

          return changed ? { ...list, products } : list;
        })
      );
    };

    const hasPhotosToHydrate = lists.some((list) =>
      list.products.some((product) => product.photoAssetId && !product.photo)
    );

    if (hasPhotosToHydrate) {
      void hydratePersistedPhotos();
    }

    return () => {
      cancelled = true;
    };
  }, [lists]);

  const openList = useCallback(
    ({ title, person, flag, empresa }: OpenListParams): boolean => {
      const normalizedTitle = flag === "cd" ? (title.trim() || "CD") : title.trim();

      if (flag !== "cd" && !normalizedTitle) {
        toast({ title: "Informe a secao", variant: "destructive" });
        return false;
      }

      if (!person.trim()) {
        toast({ title: "Informe o nome", variant: "destructive" });
        return false;
      }

      const newList: ListData = {
        id: crypto.randomUUID(),
        title: normalizedTitle,
        person: person.trim(),
        flag,
        empresa,
        products: [],
        createdAt: new Date(),
        status: "open",
      };

      setLists((prev) => [...prev, newList]);
      setActiveListId(newList.id);
      toast({ title: "Lista aberta!", description: `${newList.title} • ${newList.person} • ${flag.toUpperCase()}` });
      return true;
    },
    [toast]
  );

  const closeList = useCallback(() => {
    if (!activeListId) return;

    setLists((prev) =>
      prev.map((list) =>
        list.id === activeListId ? { ...list, status: "yellow" as const, closedAt: new Date() } : list
      )
    );

    setActiveListId(null);
    toast({ title: "Lista fechada!", description: "Disponivel no historico." });
  }, [activeListId, toast]);

  const addProduct = useCallback(
    async (params: AddProductParams): Promise<boolean> => {
      if (!activeList) {
        toast({ title: "Abra uma lista primeiro", variant: "destructive" });
        return false;
      }

      if (!params.barcode.trim()) {
        toast({ title: "Preencha o codigo de barras", variant: "destructive" });
        return false;
      }

      if (!params.quantity || params.quantity <= 0) {
        toast({ title: "Informe a quantidade", variant: "destructive" });
        return false;
      }

      const barcode = params.barcode.trim();
      const quantity = params.quantity;
      const newProductId = crypto.randomUUID();
      const preparedPhoto = await preparePhotoForRuntime(params.photo);
      let merged = false;
      let replacedProduct: Product | undefined;

      setLists((prev) =>
        prev.map((list) => {
          if (list.id !== activeListId) return list;

          const existingIndex = list.products.findIndex((product) => product.barcode === barcode);
          if (existingIndex !== -1) {
            merged = true;
            const updatedProducts = [...list.products];
            const existing = updatedProducts[existingIndex];
            replacedProduct = params.photo ? existing : undefined;

            updatedProducts[existingIndex] = {
              ...existing,
              quantity: existing.quantity + quantity,
              ...(params.photo ? preparedPhoto : {}),
              ...(params.secao?.trim() ? { secao: params.secao.trim() } : {}),
              ...(params.erpProdutoId ? { erpProdutoId: params.erpProdutoId } : {}),
              erpPhotoMissing: params.erpPhotoMissing ?? false,
              appPhotoWithoutErp: params.appPhotoWithoutErp ?? false,
            };

            return { ...list, products: updatedProducts };
          }

          const newProduct: Product = {
            id: newProductId,
            barcode,
            sku: params.sku.trim(),
            description: params.description?.trim() || undefined,
            secao: params.secao?.trim() || undefined,
            ...preparedPhoto,
            erpProdutoId: params.erpProdutoId,
            erpPhotoMissing: params.erpPhotoMissing ?? false,
            appPhotoWithoutErp: params.appPhotoWithoutErp ?? false,
            quantity,
            removeTag: params.removeTag ?? false,
            createdAt: new Date(),
            importedFromSpreadsheet: params.importedFromSpreadsheet ?? false,
          };

          return { ...list, products: [...list.products, newProduct] };
        })
      );

      if (merged) {
        toast({ title: "Quantidade atualizada", description: barcode });
      } else {
        toast({ title: "Produto adicionado!", description: barcode });
      }

      cleanupProductPhoto(replacedProduct);

      return true;
    },
    [activeList, activeListId, toast]
  );

  const deleteProduct = useCallback((productId: string) => {
    if (!activeListId) return;

    setLists((prev) =>
      prev.map((list) => {
        if (list.id !== activeListId) return list;

        const product = list.products.find((item) => item.id === productId);
        cleanupProductPhoto(product);

        return { ...list, products: list.products.filter((product) => product.id !== productId) };
      })
    );
  }, [activeListId]);

  const updateList = useCallback((updated: ListData) => {
    setLists((prev) => prev.map((list) => (list.id === updated.id ? updated : list)));
  }, []);

  const addProductsFromSpreadsheet = useCallback(
    (items: AddProductParams[]): boolean => {
      if (!activeList) {
        toast({ title: "Abra uma lista primeiro", variant: "destructive" });
        return false;
      }

      if (items.length === 0) {
        toast({ title: "Nenhum item para importar", variant: "destructive" });
        return false;
      }

      setLists((prev) =>
        prev.map((list) => {
          if (list.id !== activeListId) return list;

          const newProducts: Product[] = items.map((item) => ({
            id: crypto.randomUUID(),
            barcode: item.barcode.trim(),
            sku: item.sku?.trim() || "",
            description: item.description?.trim() || undefined,
            photo: null,
            photoBlob: null,
            photoAssetId: null,
            erpPhotoMissing: false,
            appPhotoWithoutErp: false,
            quantity: 0,
            removeTag: false,
            createdAt: new Date(),
            importedFromSpreadsheet: true,
            qtdPlanilha: item.qtdPlanilha ?? 0,
          }));

          return { ...list, products: [...list.products, ...newProducts] };
        })
      );

      toast({ title: `${items.length} itens importados!`, description: "Preencha COD e QTD em cada item." });
      return true;
    },
    [activeList, activeListId, toast]
  );

  const updateProduct = useCallback((productId: string, updates: Partial<Product>) => {
    if (!activeListId) return;

    setLists((prev) =>
      prev.map((list) => {
        if (list.id !== activeListId) return list;
        return {
          ...list,
          products: list.products.map((product) =>
            product.id === productId ? { ...product, ...updates } : product
          ),
        };
      })
    );
  }, [activeListId]);

  const updateProductPhoto = useCallback(
    async (productId: string, photo: string | null): Promise<boolean> => {
      if (!activeListId) return false;

      const preparedPhoto = await preparePhotoForRuntime(photo);
      let replacedProduct: Product | undefined;

      setLists((prev) =>
        prev.map((list) => {
          if (list.id !== activeListId) return list;

          return {
            ...list,
            products: list.products.map((product) => {
              if (product.id !== productId) return product;
              replacedProduct = product;

              if (!photo) {
                return {
                  ...product,
                  photo: null,
                  photoBlob: null,
                  photoAssetId: null,
                  appPhotoWithoutErp: false,
                };
              }

              return {
                ...product,
                ...preparedPhoto,
                erpPhotoMissing: false,
                appPhotoWithoutErp: false,
              };
            }),
          };
        })
      );

      cleanupProductPhoto(replacedProduct);
      return true;
    },
    [activeListId]
  );

  const moveProductToTop = useCallback((productId: string) => {
    if (!activeListId) return;

    setLists((prev) =>
      prev.map((list) => {
        if (list.id !== activeListId) return list;

        const productIndex = list.products.findIndex((product) => product.id === productId);
        if (productIndex <= 0) return list;

        const updatedProducts = [...list.products];
        const [product] = updatedProducts.splice(productIndex, 1);
        updatedProducts.unshift(product);
        return { ...list, products: updatedProducts };
      })
    );
  }, [activeListId]);

  const scrollToProduct = useCallback((productId: string) => {
    if (!activeListId) return;

    setLists((prev) => {
      const newLists = prev.map((list) => {
        if (list.id !== activeListId) return list;

        const productIndex = list.products.findIndex((product) => product.id === productId);
        if (productIndex <= 0) return list;

        const updatedProducts = [...list.products];
        const [product] = updatedProducts.splice(productIndex, 1);
        updatedProducts.unshift(product);
        return { ...list, products: updatedProducts };
      });

      setTimeout(() => window.scrollTo({ top: 0, behavior: "instant" }), 50);
      return newLists;
    });
  }, [activeListId]);

  return {
    lists,
    activeList,
    openList,
    closeList,
    addProduct,
    addProductsFromSpreadsheet,
    updateProduct,
    updateProductPhoto,
    deleteProduct,
    updateList,
    moveProductToTop,
    scrollToProduct,
  };
}
