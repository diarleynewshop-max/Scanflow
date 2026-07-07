import { getPhotoBlob } from "@/lib/photoStore";

export interface RuntimePhotoLike {
  photo: string | null;
  photoBlob?: Blob | null;
  photoAssetId?: string | null;
}

export function isObjectPhotoUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("blob:");
}

export function isDataPhotoUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && /^data:image\/[a-zA-Z0-9.+-]+(?:;[^;,]+)*;base64,/i.test(value);
}

export function isRemotePhotoUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

export function createRuntimePhoto(blob: Blob): { photo: string; photoBlob: Blob } {
  return {
    photo: URL.createObjectURL(blob),
    photoBlob: blob,
  };
}

export function revokePhotoUrl(value: string | null | undefined): void {
  if (!isObjectPhotoUrl(value)) return;

  try {
    URL.revokeObjectURL(value);
  } catch {
    // ignore
  }
}

export function revokeRuntimePhoto(photo: RuntimePhotoLike | null | undefined): void {
  if (!photo?.photoBlob) return;
  revokePhotoUrl(photo.photo);
}

export function shouldPersistPhoto(photo: RuntimePhotoLike | null | undefined): boolean {
  if (!photo?.photo) return false;
  return isDataPhotoUrl(photo.photo) || isRemotePhotoUrl(photo.photo);
}

export function stripPhotoForPersistence<T extends RuntimePhotoLike>(photo: T): T {
  const persistedPhoto =
    isRemotePhotoUrl(photo.photo) || (isDataPhotoUrl(photo.photo) && !photo.photoAssetId)
      ? photo.photo
      : null;

  return {
    ...photo,
    photo: persistedPhoto,
    photoBlob: undefined,
    photoAssetId: persistedPhoto ? undefined : photo.photoAssetId,
  };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Falha ao ler foto"));
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mimeType = header.match(/^data:([^;]+)(?:;[^;]+)*;base64$/i)?.[1] ?? "image/jpeg";
  const binary = atob(base64 ?? "");
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

async function fetchPhotoBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao carregar foto (${response.status})`);
  }

  return await response.blob();
}

export async function resolvePhotoToDataUrl(photo: RuntimePhotoLike): Promise<string | null> {
  if (photo.photoBlob instanceof Blob) {
    return await blobToDataUrl(photo.photoBlob);
  }

  if (photo.photoAssetId) {
    const blob = await getPhotoBlob(photo.photoAssetId).catch(() => null);
    if (blob) {
      return await blobToDataUrl(blob);
    }
  }

  if (!photo.photo) {
    return null;
  }

  if (isDataPhotoUrl(photo.photo)) {
    return photo.photo;
  }

  if (isObjectPhotoUrl(photo.photo) || isRemotePhotoUrl(photo.photo)) {
    try {
      const blob = await fetchPhotoBlob(photo.photo);
      return await blobToDataUrl(blob);
    } catch {
      return null;
    }
  }

  return null;
}
