import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, X, ScanBarcode, Upload, Loader2 } from "lucide-react";

interface BarcodeScannerProps {
  onDetected: (code: string) => void;
  onClose: () => void;
}

const NATIVE_BARCODE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "code_93",
  "itf",
  "qr_code",
] as const;

const ZXING_MAX_PHOTO_EDGE = 2200;

const PHOTO_SCAN_VARIANTS = [
  { x: 0, y: 0, width: 1, height: 1, rotate: 0 },
  { x: 0.04, y: 0.18, width: 0.92, height: 0.64, rotate: 0 },
  { x: 0.08, y: 0.28, width: 0.84, height: 0.44, rotate: 0 },
  { x: 0, y: 0, width: 1, height: 1, rotate: 90 },
  { x: 0.04, y: 0.18, width: 0.92, height: 0.64, rotate: 90 },
  { x: 0.08, y: 0.28, width: 0.84, height: 0.44, rotate: 90 },
  { x: 0, y: 0, width: 1, height: 1, rotate: -90 },
] as const;

type NativeBarcode = {
  rawValue?: string;
};

type NativeBarcodeDetector = {
  detect: (source: CanvasImageSource) => Promise<NativeBarcode[]>;
};

type NativeBarcodeDetectorConstructor = new (options?: {
  formats?: readonly string[];
}) => NativeBarcodeDetector;

function getNativeBarcodeDetector(): NativeBarcodeDetectorConstructor | null {
  if (typeof window === "undefined" || !("BarcodeDetector" in window)) {
    return null;
  }

  return (window as Window & { BarcodeDetector: NativeBarcodeDetectorConstructor }).BarcodeDetector;
}

const hasNativeBarcodeDetector = Boolean(getNativeBarcodeDetector());
let nativeBarcodeDetector: NativeBarcodeDetector | null = null;

async function detectWithNativeBarcodeDetector(source: CanvasImageSource): Promise<string | null> {
  const BarcodeDetectorClass = getNativeBarcodeDetector();
  if (!BarcodeDetectorClass) return null;

  try {
    nativeBarcodeDetector ??= new BarcodeDetectorClass({ formats: NATIVE_BARCODE_FORMATS });
    const barcodes = await nativeBarcodeDetector.detect(source);
    const detected = barcodes.find((barcode) => typeof barcode.rawValue === "string" && barcode.rawValue.trim());
    return detected?.rawValue?.trim() ?? null;
  } catch {
    return null;
  }
}

function clampBetweenZeroAndOne(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function createCanvasVariant(
  image: HTMLImageElement,
  variant: (typeof PHOTO_SCAN_VARIANTS)[number]
): HTMLCanvasElement {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  const cropX = Math.round(clampBetweenZeroAndOne(variant.x) * sourceWidth);
  const cropY = Math.round(clampBetweenZeroAndOne(variant.y) * sourceHeight);
  const cropWidth = Math.max(1, Math.round(clampBetweenZeroAndOne(variant.width) * sourceWidth));
  const cropHeight = Math.max(1, Math.round(clampBetweenZeroAndOne(variant.height) * sourceHeight));

  const safeCropWidth = Math.min(cropWidth, sourceWidth - cropX);
  const safeCropHeight = Math.min(cropHeight, sourceHeight - cropY);
  const scale = Math.min(1, ZXING_MAX_PHOTO_EDGE / Math.max(safeCropWidth, safeCropHeight));
  const targetWidth = Math.max(1, Math.round(safeCropWidth * scale));
  const targetHeight = Math.max(1, Math.round(safeCropHeight * scale));

  const canvas = document.createElement("canvas");
  const isQuarterTurn = Math.abs(variant.rotate) === 90;

  canvas.width = isQuarterTurn ? targetHeight : targetWidth;
  canvas.height = isQuarterTurn ? targetWidth : targetHeight;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Falha ao preparar leitura da imagem");
  }

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((variant.rotate * Math.PI) / 180);
  ctx.drawImage(
    image,
    cropX,
    cropY,
    safeCropWidth,
    safeCropHeight,
    -targetWidth / 2,
    -targetHeight / 2,
    targetWidth,
    targetHeight
  );

  return canvas;
}

async function decodeCanvasWithZxing(canvas: HTMLCanvasElement): Promise<string | null> {
  const {
    BarcodeFormat,
    BinaryBitmap,
    DecodeHintType,
    GlobalHistogramBinarizer,
    HTMLCanvasElementLuminanceSource,
    HybridBinarizer,
    MultiFormatReader,
  } = await import("@zxing/library");

  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.CODE_93,
    BarcodeFormat.ITF,
    BarcodeFormat.QR_CODE,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);

  const attempts = [
    () => new BinaryBitmap(new HybridBinarizer(new HTMLCanvasElementLuminanceSource(canvas))),
    () => new BinaryBitmap(new GlobalHistogramBinarizer(new HTMLCanvasElementLuminanceSource(canvas))),
    () => new BinaryBitmap(new HybridBinarizer(new HTMLCanvasElementLuminanceSource(canvas, true))),
    () => new BinaryBitmap(new GlobalHistogramBinarizer(new HTMLCanvasElementLuminanceSource(canvas, true))),
  ];

  for (const createBitmap of attempts) {
    try {
      const reader = new MultiFormatReader();
      const result = reader.decode(createBitmap(), hints);
      const value = result.getText().trim();
      if (value) {
        return value;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function detectWithZxing(image: HTMLImageElement): Promise<string | null> {
  for (const variant of PHOTO_SCAN_VARIANTS) {
    const canvas = createCanvasVariant(image, variant);

    try {
      const code = await decodeCanvasWithZxing(canvas);
      if (code) {
        return code;
      }
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  return null;
}

function loadImageFromFile(file: File): Promise<{ image: HTMLImageElement; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => resolve({ image, objectUrl });
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Falha ao carregar imagem"));
    };
    image.src = objectUrl;
  });
}

const BarcodeScanner = ({ onDetected, onClose }: BarcodeScannerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const detectedRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const useFileMode = !hasNativeBarcodeDetector;

  const cleanup = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (useFileMode) return;

    let cancelled = false;
    detectedRef.current = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const scan = async () => {
          if (cancelled || detectedRef.current || !videoRef.current) return;

          const code = await detectWithNativeBarcodeDetector(videoRef.current);
          if (code && !detectedRef.current) {
            detectedRef.current = true;
            cleanup();
            onDetected(code);
            return;
          }

          animFrameRef.current = requestAnimationFrame(scan);
        };

        scan();
      } catch {
        if (!cancelled) {
          setError("Nao foi possivel acessar a camera. Verifique as permissoes.");
        }
      }
    };

    start();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [cleanup, onDetected, useFileMode]);

  const handleFileCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setProcessing(true);

    try {
      const { image, objectUrl } = await loadImageFromFile(file);

      try {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;

          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0);
          }
        }

        const nativeCode = canvas ? await detectWithNativeBarcodeDetector(canvas) : null;
        const fallbackCode = nativeCode || await detectWithZxing(image);

        if (fallbackCode) {
          onDetected(fallbackCode);
          return;
        }

        setError("Nenhum codigo de barras foi identificado. Tente novamente com uma foto mais nitida e o codigo ocupando mais espaco.");
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      setError("Nao foi possivel ler a imagem. Tente novamente.");
    } finally {
      setProcessing(false);
    }
  };

  const handleClose = () => {
    cleanup();
    onClose();
  };

  const handleRetry = () => {
    setError(null);

    if (useFileMode) {
      cameraInputRef.current?.click();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-foreground/90 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 text-primary-foreground">
          <ScanBarcode className="w-5 h-5" />
          <span className="font-semibold text-sm">
            {useFileMode ? "Capturar codigo" : "Escaneando..."}
          </span>
        </div>

        <button
          onClick={handleClose}
          className="w-9 h-9 rounded-full bg-card/20 flex items-center justify-center"
        >
          <X className="w-5 h-5 text-primary-foreground" />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          {processing ? (
            <div className="text-center text-primary-foreground bg-card/20 rounded-xl p-5">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
              <p className="font-medium">Lendo codigo da imagem...</p>
            </div>
          ) : error ? (
            <div className="text-center text-destructive-foreground bg-destructive/80 rounded-xl p-4">
              <p className="font-medium">{error}</p>
              <div className="flex gap-2 mt-3 justify-center">
                <button
                  onClick={handleRetry}
                  className="px-4 py-2 bg-card text-foreground rounded-lg text-sm font-semibold"
                >
                  Tentar novamente
                </button>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 bg-card text-foreground rounded-lg text-sm font-semibold"
                >
                  Fechar
                </button>
              </div>
            </div>
          ) : useFileMode ? (
            <div className="text-center space-y-4">
              <div className="w-20 h-20 rounded-full bg-card/20 flex items-center justify-center mx-auto">
                <Camera className="w-10 h-10 text-primary-foreground" />
              </div>

              <p className="text-primary-foreground font-semibold">
                Tire uma foto do codigo de barras
              </p>

              <p className="text-primary-foreground/70 text-sm">
                No iPhone, o codigo sera lido direto da imagem capturada
              </p>

              <label style={{ display: "block", width: "100%" }}>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileCapture}
                  style={{ display: "none", position: "absolute", opacity: 0, pointerEvents: "none" }}
                />
                <span
                  className="w-full h-14 bg-primary text-primary-foreground rounded-xl font-bold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg"
                  style={{ cursor: "pointer" }}
                >
                  <Camera className="w-5 h-5" /> Abrir Camera
                </span>
              </label>

              <label style={{ display: "block", width: "100%" }}>
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileCapture}
                  style={{ display: "none", position: "absolute", opacity: 0, pointerEvents: "none" }}
                />
                <span
                  className="w-full h-12 bg-card/20 text-primary-foreground rounded-xl font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                  style={{ cursor: "pointer" }}
                >
                  <Upload className="w-4 h-4" /> Escolher da Galeria
                </span>
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-2xl overflow-hidden">
                <video ref={videoRef} className="w-full rounded-2xl" playsInline muted />
              </div>

              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileCapture}
                className="hidden"
              />

              <button
                onClick={() => galleryInputRef.current?.click()}
                className="w-full h-11 bg-card/20 text-primary-foreground rounded-xl font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform border border-white/20"
              >
                <Upload className="w-4 h-4" /> Escolher da Galeria
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="pb-8 pt-4 text-center">
        <p className="text-primary-foreground/70 text-sm">
          {useFileMode
            ? "Aproxime bem o codigo e evite sombras na foto"
            : "Aponte a camera para o codigo de barras"}
        </p>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default BarcodeScanner;
