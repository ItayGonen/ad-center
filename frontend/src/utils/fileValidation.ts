import i18n from '../i18n';

const SIGNATURES: { mime: string; offset: number; bytes: number[] }[] = [
  { mime: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] },
  // MP4/MOV — "ftyp" at bytes 4-7
  { mime: 'video/mp4', offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
  // MOV alt — "moov" at bytes 4-7
  { mime: 'video/quicktime', offset: 4, bytes: [0x6d, 0x6f, 0x6f, 0x76] },
];

const IMAGE_MAX_MB = 10;
const VIDEO_MAX_MB = 50;

function t(key: string, opts?: Record<string, unknown>): string {
  return i18n.t(key, { ns: 'orders', ...opts }) as string;
}

function readBytes(file: File, count: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file.slice(0, count));
  });
}

export async function validateFile(file: File): Promise<{ valid: boolean; error?: string }> {
  try {
    const header = await readBytes(file, 12);
    const matched = SIGNATURES.some(sig =>
      sig.bytes.every((b, i) => header[sig.offset + i] === b),
    );
    if (!matched) return { valid: false, error: t('invalidFileFormat') };

    const isVideo = file.type.startsWith('video/') ||
      SIGNATURES.filter(s => s.mime.startsWith('video/')).some(sig =>
        sig.bytes.every((b, i) => header[sig.offset + i] === b),
      );
    const maxMB = isVideo ? VIDEO_MAX_MB : IMAGE_MAX_MB;
    if (file.size > maxMB * 1024 * 1024) {
      return { valid: false, error: t('fileTooLarge', { max: maxMB }) };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: t('invalidFileFormat') };
  }
}

export async function validateFiles(files: File[]): Promise<{ validFiles: File[]; errors: string[] }> {
  const validFiles: File[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const result = await validateFile(file);
    if (result.valid) {
      validFiles.push(file);
    } else {
      errors.push(`${file.name}: ${result.error}`);
    }
  }

  return { validFiles, errors };
}

export function generateVideoThumbnail(source: File | string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;

    const isFile = source instanceof File;
    const url = isFile ? URL.createObjectURL(source) : source;
    video.src = url;

    const cleanup = () => {
      if (isFile) URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };

    video.onloadeddata = () => {
      video.currentTime = Math.min(1, video.duration * 0.1);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { cleanup(); reject(new Error('Canvas context failed')); return; }
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        cleanup();
        resolve(dataUrl);
      } catch (e) {
        cleanup();
        reject(e);
      }
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Video load failed'));
    };
  });
}
