export interface ProcessImageOptions {
  grayscale?: boolean;
  highContrast?: boolean;
  quality?: number; // 0.1 to 1.0
  mimeType?: 'image/jpeg' | 'image/webp';
  crop?: { top: number, bottom: number, left: number, right: number }; // percentages 0-100
}

export async function processImageCanvas(
  fileOrBlob: Blob,
  options: ProcessImageOptions = {}
): Promise<string> {
  const {
    grayscale = false,
    highContrast = false,
    quality = 0.8,
    mimeType = 'image/jpeg',
    crop = { top: 0, bottom: 0, left: 0, right: 0 }
  } = options;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(fileOrBlob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      
      const MAX_DIM = 2048;
      
      // Calculate cropped source dimensions
      const srcX = (img.width * crop.left) / 100;
      const srcY = (img.height * crop.top) / 100;
      const srcW = img.width - srcX - ((img.width * crop.right) / 100);
      const srcH = img.height - srcY - ((img.height * crop.bottom) / 100);
      
      // Target dimensions (with max constraint)
      let targetW = srcW;
      let targetH = srcH;
      
      if (targetW > MAX_DIM || targetH > MAX_DIM) {
        if (targetW > targetH) {
          targetH = Math.round((targetH * MAX_DIM) / targetW);
          targetW = MAX_DIM;
        } else {
          targetW = Math.round((targetW * MAX_DIM) / targetH);
          targetH = MAX_DIM;
        }
      }

      // Safeguard against invalid crops
      if (targetW <= 0 || targetH <= 0) {
          resolve("");
          return;
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      canvas.width = targetW;
      canvas.height = targetH;

      // Draw cropped original
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, targetW, targetH);

      // Apply filters if needed
      if (grayscale || highContrast) {
        const imageData = ctx.getImageData(0, 0, targetW, targetH);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
          let r = data[i];
          let g = data[i + 1];
          let b = data[i + 2];

          // Grayscale
          if (grayscale) {
            const avg = 0.299 * r + 0.587 * g + 0.114 * b;
            r = g = b = avg;
          }

          // High Contrast
          if (highContrast) {
            const factor = (259 * (128 + 255)) / (255 * (259 - 128));
            r = factor * (r - 128) + 128;
            g = factor * (g - 128) + 128;
            b = factor * (b - 128) + 128;
            // clamp
            r = Math.max(0, Math.min(255, r));
            g = Math.max(0, Math.min(255, g));
            b = Math.max(0, Math.min(255, b));
          }

          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
        }
        ctx.putImageData(imageData, 0, 0);
      }

      resolve(canvas.toDataURL(mimeType, quality));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for processing'));
    };

    img.src = url;
  });
}
