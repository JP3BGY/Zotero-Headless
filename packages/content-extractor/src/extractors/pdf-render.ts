import * as fs from 'fs';
import type { RenderedPage, RenderOptions, AnnotationRegion, RenderedAnnotation } from '../types.js';

/**
 * Render PDF pages to PNG/JPEG images using PDFium (Chrome's PDF engine).
 */
export async function renderPdfPages(
  filePath: string,
  options?: RenderOptions,
): Promise<RenderedPage[]> {
  const { PDFiumLibrary } = await import('@hyzyla/pdfium');
  const sharp = (await import('sharp')).default;

  const scale = options?.scale ?? 2;
  const pages = options?.pages;
  const imageFormat = options?.imageFormat ?? 'png';

  const pdfBuffer = fs.readFileSync(filePath);
  const library = await PDFiumLibrary.init();

  try {
    const doc = await library.loadDocument(new Uint8Array(pdfBuffer));
    const pageCount = doc.getPageCount();

    // Determine which pages to render (user provides 1-indexed)
    let pageIndices: number[];
    if (pages && pages.length > 0) {
      pageIndices = pages
        .map(p => p - 1)
        .filter(p => p >= 0 && p < pageCount);
    } else {
      pageIndices = Array.from({ length: pageCount }, (_, i) => i);
    }

    const results: RenderedPage[] = [];

    for (const pageIndex of pageIndices) {
      const page = doc.getPage(pageIndex);

      // Render to raw bitmap (BGRA)
      const rendered = await page.render({ scale });

      // Convert BGRA bitmap to PNG/JPEG via sharp
      let imageBuffer: Buffer;
      const sharpInstance = sharp(Buffer.from(rendered.data), {
        raw: { width: rendered.width, height: rendered.height, channels: 4 },
      });

      if (imageFormat === 'jpeg') {
        imageBuffer = await sharpInstance.jpeg({ quality: options?.quality ?? 85 }).toBuffer();
      } else {
        imageBuffer = await sharpInstance.png().toBuffer();
      }

      results.push({
        pageNumber: pageIndex + 1,
        width: rendered.width,
        height: rendered.height,
        imageFormat,
        data: imageBuffer,
      });
    }

    doc.destroy();
    return results;
  } finally {
    library.destroy();
  }
}

/**
 * Render a specific annotation region from a PDF page.
 *
 * The annotation position uses PDF coordinates (origin at bottom-left).
 * PDFium renders with origin at top-left. We render the full page then
 * crop to the annotation rect using sharp, matching Zotero Desktop's
 * approach (render page → crop) but with PDFium instead of pdf.js.
 *
 * Scale factor 4 matches Zotero Desktop's SCALE constant for annotation images.
 */
export async function renderAnnotationRegion(
  filePath: string,
  region: AnnotationRegion,
  options?: { scale?: number; imageFormat?: 'png' | 'jpeg'; quality?: number },
): Promise<RenderedAnnotation> {
  const { PDFiumLibrary } = await import('@hyzyla/pdfium');
  const sharp = (await import('sharp')).default;

  const scale = options?.scale ?? 4; // Match Zotero Desktop's 4x scale
  const imageFormat = options?.imageFormat ?? 'png';

  const pdfBuffer = fs.readFileSync(filePath);
  const library = await PDFiumLibrary.init();

  try {
    const doc = await library.loadDocument(new Uint8Array(pdfBuffer));
    const pageCount = doc.getPageCount();

    if (region.pageIndex < 0 || region.pageIndex >= pageCount) {
      throw new Error(`Page index ${region.pageIndex} out of range (0-${pageCount - 1})`);
    }

    const page = doc.getPage(region.pageIndex);
    const { originalWidth, originalHeight } = page.getOriginalSize();

    // Render the full page at the target scale
    const rendered = await page.render({ scale });

    // Get the annotation rect [left, bottom, right, top] in PDF coordinates
    const rect = region.rects?.[0];
    if (!rect || rect.length < 4) {
      throw new Error('Annotation region must have at least one rect with 4 values');
    }

    const [pdfLeft, pdfBottom, pdfRight, pdfTop] = rect;

    // Convert PDF coordinates (origin bottom-left) to pixel coordinates (origin top-left)
    // PDF Y increases upward; pixel Y increases downward
    const pixelLeft = Math.max(0, Math.floor(pdfLeft * scale));
    const pixelTop = Math.max(0, Math.floor((originalHeight - pdfTop) * scale));
    const pixelRight = Math.min(rendered.width, Math.ceil(pdfRight * scale));
    const pixelBottom = Math.min(rendered.height, Math.ceil((originalHeight - pdfBottom) * scale));

    const cropWidth = Math.max(1, pixelRight - pixelLeft);
    const cropHeight = Math.max(1, pixelBottom - pixelTop);

    // Crop the rendered page to the annotation region
    let imageBuffer: Buffer;
    const sharpInstance = sharp(Buffer.from(rendered.data), {
      raw: { width: rendered.width, height: rendered.height, channels: 4 },
    }).extract({
      left: pixelLeft,
      top: pixelTop,
      width: cropWidth,
      height: cropHeight,
    });

    if (imageFormat === 'jpeg') {
      imageBuffer = await sharpInstance.jpeg({ quality: options?.quality ?? 85 }).toBuffer();
    } else {
      imageBuffer = await sharpInstance.png().toBuffer();
    }

    doc.destroy();

    return {
      width: cropWidth,
      height: cropHeight,
      imageFormat,
      data: imageBuffer,
    };
  } finally {
    library.destroy();
  }
}
