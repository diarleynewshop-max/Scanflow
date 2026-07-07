export interface ProdutoComprar {
  id: string;
  codigo: string;
  sku: string | null;
  descricao: string;
  foto: string | null;
  status: 'novo' | 'analisado' | 'comprado' | 'reprovado';
  empresa: string;
  receivedAt: number;
}

class ProdutosCache {
  private cache = new Map<string, ProdutoComprar>();

  get(key: string): ProdutoComprar | undefined {
    return this.cache.get(key);
  }

  getAll(): ProdutoComprar[] {
    return Array.from(this.cache.values());
  }

  getByStatus(status: ProdutoComprar['status']): ProdutoComprar[] {
    return this.getAll().filter(p => p.status === status);
  }

  set(produto: ProdutoComprar) {
    this.cache.set(produto.id, produto);
  }

  updateStatus(id: string, status: ProdutoComprar['status']) {
    const produto = this.cache.get(id);
    if (produto) {
      produto.status = status;
    }
  }

  delete(id: string) {
    this.cache.delete(id);
  }

  clear() {
    this.cache.clear();
  }
}

export const produtosCache = new ProdutosCache();