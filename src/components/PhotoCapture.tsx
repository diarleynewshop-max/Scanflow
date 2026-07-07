import { Camera, X, Upload } from "lucide-react";

type CompressionPreset = "default" | "light";

interface PhotoCaptureProps {
  photo: string | null;
  onCapture: (photo: string) => void;
  onRemove: () => void;
  compressionPreset?: CompressionPreset;
}

const PRESET_CONFIG: Record<CompressionPreset, { maxEdge: number; quality: number }> = {
  default: { maxEdge: 1600, quality: 0.72 },
  light: { maxEdge: 768, quality: 0.42 },
};

function loadImageFromFile(file: File): Promise<{ image: HTMLImageElement; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => resolve({ image: img, objectUrl });
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Falha ao carregar imagem"));
    };
    img.src = objectUrl;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Falha ao ler imagem"));
    reader.readAsDataURL(file);
  });
}

async function compressPhoto(file: File, preset: CompressionPreset): Promise<string> {
  const { image, objectUrl } = await loadImageFromFile(file);
  const { maxEdge, quality } = PRESET_CONFIG[preset];
  const canvas = document.createElement("canvas");

  try {
    const currentMaxEdge = Math.max(image.width, image.height);
    const scale = currentMaxEdge > maxEdge ? maxEdge / currentMaxEdge : 1;

    const targetWidth = Math.max(1, Math.round(image.width * scale));
    const targetHeight = Math.max(1, Math.round(image.height * scale));

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("Falha ao preparar canvas");
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    image.src = "";
    URL.revokeObjectURL(objectUrl);
  }
}

const PhotoCapture = ({ photo, onCapture, onRemove, compressionPreset = "default" }: PhotoCaptureProps) => {
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      e.target.value = "";
      return;
    }

    try {
      const nextPhoto = await compressPhoto(file, compressionPreset);
      onCapture(nextPhoto);
    } catch (error) {
      console.error("[PhotoCapture] Falha ao processar foto:", error);

      try {
        onCapture(await readFileAsDataUrl(file));
      } catch {
        window.alert("Nao foi possivel processar a foto neste aparelho. Tente novamente ou use uma foto menor.");
      }
    } finally {
      e.target.value = "";
    }
  };

  if (photo) {
    return (
      <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", borderRadius: 10, overflow: "hidden", border: "1.5px solid hsl(var(--border))" }}>
        <img src={photo} alt="Produto" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <button onClick={onRemove}
          style={{ position: "absolute", top: 8, right: 8, background: "hsl(var(--destructive))", color: "#fff", border: "none", borderRadius: "50%", width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "var(--shadow-sm)" }}
        >
          <X style={{ width: 14, height: 14 }} />
        </button>
      </div>
    );
  }

  return (
    <div style={{
      width: "100%", aspectRatio: "16/9", borderRadius: 10,
      border: "2px dashed hsl(var(--border))", background: "hsl(var(--secondary))",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 12, padding: "16px",
    }}>
      <p style={{ fontSize: 13, fontWeight: 500, color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>
        Adicionar foto do produto
      </p>

      <div style={{ display: "flex", gap: 12, width: "100%" }}>
        <label style={{ flex: 1, display: "block", cursor: "pointer" }}>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileSelect}
            style={{ display: "none", position: "absolute", opacity: 0, pointerEvents: "none" }}
          />
          <span style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            height: 100, borderRadius: 10, gap: 8,
            background: "hsl(var(--primary) / 0.08)", border: "1.5px solid hsl(var(--primary) / 0.3)",
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "hsl(var(--primary) / 0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Camera style={{ width: 18, height: 18, color: "hsl(var(--primary))" }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--primary))" }}>Tirar foto</span>
          </span>
        </label>

        <label style={{ flex: 1, display: "block", cursor: "pointer" }}>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            style={{ display: "none", position: "absolute", opacity: 0, pointerEvents: "none" }}
          />
          <span style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            height: 100, borderRadius: 10, gap: 8,
            background: "hsl(var(--secondary))", border: "1.5px solid hsl(var(--border))",
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "hsl(var(--muted))", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Upload style={{ width: 18, height: 18, color: "hsl(var(--foreground))" }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--foreground))" }}>Da galeria</span>
          </span>
        </label>
      </div>
    </div>
  );
};

export default PhotoCapture;
