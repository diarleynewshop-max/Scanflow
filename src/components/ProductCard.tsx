import { Package, Trash2, Camera, Hash, Minus, Plus, ArrowUp } from "lucide-react";

export interface Product {
  id: string;
  barcode: string;
  sku: string;
  description?: string;
  secao?: string;
  photo: string | null;
  photoBlob?: Blob | null;
  photoAssetId?: string | null;
  erpProdutoId?: string;
  erpPhotoMissing?: boolean;
  appPhotoWithoutErp?: boolean;
  quantity: number;
  removeTag: boolean;
  createdAt: Date;
  importedFromSpreadsheet?: boolean;
  qtdPlanilha?: number; // Quantidade vinda da planilha (coluna D) — nunca exibida ao usuário
}

export type ListFlag = "loja" | "cd";

export interface ListData {
  id: string;
  title: string;
  person: string;
  empresa: string;  // "NEWSHOP" | "SOYE" | "FACIL ATACADO"
  products: Product[];
  createdAt: Date;
  closedAt?: Date;
  status: "open" | "yellow" | "green" | "red";
  flag: ListFlag; // "loja" | "cd"
  sentToConference?: boolean; // true depois do primeiro envio bem-sucedido
}

interface ProductCardProps {
  product: Product;
  onDelete: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<Product>) => void;
  onCapturePhoto?: (id: string) => void;
  onMoveToTop?: (id: string) => void;
  modoDesktop?: boolean;
}

const ProductCard = ({ product, onDelete, onUpdate, onCapturePhoto, onMoveToTop, modoDesktop = false }: ProductCardProps) => {
  const isImported = product.importedFromSpreadsheet;
  const needsInput = isImported && (!product.barcode || product.quantity === 0);
  
  return (
    <div style={{
      background: "#fff", 
      borderRadius: modoDesktop ? 14 : 12, 
      border: "1px solid hsl(var(--border))",
      padding: modoDesktop ? "16px 18px" : "12px 14px", 
      display: "flex", 
      gap: modoDesktop ? 16 : 12, 
      alignItems: "center",
      boxShadow: modoDesktop ? "var(--shadow-sm)" : "var(--shadow-xs)",
    }}>
      {product.photo ? (
        <div style={{ position: "relative", width: modoDesktop ? 60 : 52, height: modoDesktop ? 60 : 52, flexShrink: 0 }}>
          <img src={product.photo} alt="Produto" style={{ width: "100%", height: "100%", borderRadius: modoDesktop ? 10 : 8, objectFit: "cover" }} />
          {isImported && onCapturePhoto && (
            <button onClick={() => onCapturePhoto(product.id)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", border: "none", borderRadius: modoDesktop ? 10 : 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Camera style={{ width: modoDesktop ? 18 : 16, height: modoDesktop ? 18 : 16, color: "#fff" }} />
            </button>
          )}
        </div>
      ) : (
        <button onClick={() => onCapturePhoto?.(product.id)} disabled={!isImported || !onCapturePhoto} style={{ 
          width: modoDesktop ? 60 : 52, 
          height: modoDesktop ? 60 : 52, 
          borderRadius: modoDesktop ? 10 : 8, 
          background: isImported ? "hsl(var(--primary) / 0.1)" : "hsl(var(--muted))", 
          border: isImported ? "2px dashed hsl(var(--primary))" : "none",
          display: "flex", 
          alignItems: "center", 
          justifyContent: "center", 
          flexShrink: 0,
          cursor: isImported && onCapturePhoto ? "pointer" : "default"
        }}>
          {isImported ? (
            <Camera style={{ width: modoDesktop ? 22 : 20, height: modoDesktop ? 22 : 20, color: "hsl(var(--primary))" }} />
          ) : (
            <Package style={{ width: modoDesktop ? 22 : 20, height: modoDesktop ? 22 : 20, color: "hsl(var(--muted-foreground))" }} />
          )}
        </button>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        {isImported ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Hash style={{ width: 12, height: 12, color: "hsl(var(--muted-foreground))" }} />
            <input
              type="text"
              placeholder="COD (bipar)"
              value={product.barcode}
              onChange={(e) => onUpdate?.(product.id, { barcode: e.target.value })}
              style={{
                flex: 1,
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid hsl(var(--border))",
                background: "hsl(var(--secondary))",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                fontWeight: 500,
              }}
            />
          </div>
        ) : (
          <p style={{ 
            fontFamily: "var(--font-mono)", 
            fontSize: modoDesktop ? 13 : 12, 
            fontWeight: 500, 
            color: "hsl(var(--foreground))", 
            overflow: "hidden", 
            textOverflow: "ellipsis", 
            whiteSpace: "nowrap" 
          }}>
            {product.barcode}
          </p>
        )}
        <p style={{ 
          fontSize: modoDesktop ? 14 : 13, 
          fontWeight: 600, 
          color: "hsl(var(--foreground))", 
          marginTop: 2, 
          overflow: "hidden", 
          textOverflow: "ellipsis", 
          whiteSpace: modoDesktop ? "normal" : "nowrap",
          lineHeight: 1.4
        }}>
          {product.description || product.sku || "Produto sem descrição"}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          {isImported ? (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                onClick={() => onUpdate?.(product.id, { quantity: Math.max(0, product.quantity - 1) })}
                style={{ width: 28, height: 28, borderRadius: 6, background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Minus style={{ width: 12, height: 12 }} />
              </button>
              <span style={{ fontSize: 14, fontWeight: 700, color: "hsl(var(--primary))", minWidth: 24, textAlign: "center" }}>
                {product.quantity}
              </span>
              <button
                onClick={() => onUpdate?.(product.id, { quantity: product.quantity + 1 })}
                style={{ width: 28, height: 28, borderRadius: 6, background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Plus style={{ width: 12, height: 12 }} />
              </button>
            </div>
          ) : (
            <span style={{ 
              fontSize: modoDesktop ? 13 : 12, 
              fontWeight: 700, 
              color: "hsl(var(--primary))" 
            }}>
              Qtd: {product.quantity}
            </span>
          )}
          {product.removeTag && (
            <span style={{ 
              fontSize: modoDesktop ? 11 : 10, 
              fontWeight: 700, 
              color: "hsl(var(--destructive))", 
              background: "hsl(var(--destructive) / 0.1)", 
              padding: modoDesktop ? "3px 8px" : "2px 6px", 
              borderRadius: 4 
            }}>
              REMOVER TAG
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {onMoveToTop && (
          <button onClick={() => onMoveToTop(product.id)} title="Mover para cima" style={{ 
            background: "none", 
            border: "none", 
            cursor: "pointer", 
            color: "hsl(var(--primary))", 
            padding: 4, 
            display: "flex" 
          }}>
            <ArrowUp style={{ width: modoDesktop ? 18 : 16, height: modoDesktop ? 18 : 16 }} />
          </button>
        )}
        <button onClick={() => onDelete(product.id)} title="Excluir" style={{ 
          background: "none", 
          border: "none", 
          cursor: "pointer", 
          color: "hsl(var(--destructive))", 
          padding: 4, 
          display: "flex" 
        }}>
          <Trash2 style={{ width: modoDesktop ? 18 : 16, height: modoDesktop ? 18 : 16 }} />
        </button>
      </div>
    </div>
  );
};

export default ProductCard;


