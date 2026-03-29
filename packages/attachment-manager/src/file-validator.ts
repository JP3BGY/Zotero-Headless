// File type validation via magic bytes sniffing
// Supports PDF and EPUB detection without external dependencies

export const ALLOWED_MIME_TYPES = ['application/pdf', 'application/epub+zip'] as const;

export type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number];

/**
 * Detect MIME type from file content by checking magic bytes.
 * Reads the first portion of the buffer to identify PDF or EPUB files.
 *
 * PDF: starts with "%PDF-"
 * EPUB: ZIP archive (PK\x03\x04) containing "mimetypeapplication/epub+zip" near offset 30
 */
export function sniffMimeType(buffer: Buffer): AllowedMimeType | null {
  if (buffer.length < 5) return null;

  // PDF: first 5 bytes are "%PDF-"
  if (
    buffer[0] === 0x25 && // %
    buffer[1] === 0x50 && // P
    buffer[2] === 0x44 && // D
    buffer[3] === 0x46 && // F
    buffer[4] === 0x2d    // -
  ) {
    return 'application/pdf';
  }

  // EPUB: ZIP archive with epub mimetype
  // ZIP files start with PK\x03\x04
  if (
    buffer.length >= 58 &&
    buffer[0] === 0x50 && // P
    buffer[1] === 0x4b && // K
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    // EPUB ZIP files contain "mimetypeapplication/epub+zip" starting around offset 30
    // The exact offset can vary, so search within the first 58 bytes
    const header = buffer.subarray(0, 80).toString('ascii');
    if (header.includes('mimetypeapplication/epub+zip')) {
      return 'application/epub+zip';
    }
  }

  return null;
}

/**
 * Check if a file's content matches an allowed MIME type (PDF or EPUB).
 */
export function isAllowedFileType(buffer: Buffer): boolean {
  return sniffMimeType(buffer) !== null;
}

/**
 * Get file extension for a given MIME type.
 */
export function getExtensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'application/pdf': return '.pdf';
    case 'application/epub+zip': return '.epub';
    default: return '';
  }
}
