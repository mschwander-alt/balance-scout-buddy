/**
 * Utility functions for file handling and name sanitization
 */

/**
 * Sanitizes a filename for storage while preserving readability
 * Encodes special characters safely for file systems and URLs
 */
export function sanitizeFileName(fileName: string): string {
  // Split filename and extension
  const lastDotIndex = fileName.lastIndexOf('.');
  const name = lastDotIndex !== -1 ? fileName.substring(0, lastDotIndex) : fileName;
  const extension = lastDotIndex !== -1 ? fileName.substring(lastDotIndex) : '';
  
  // Encode the name part using encodeURIComponent to handle umlauts and special chars
  const encodedName = encodeURIComponent(name)
    // Replace URL-encoded characters that are problematic in file paths
    .replace(/%20/g, '_')  // spaces to underscores
    .replace(/%/g, '_');   // percent signs to underscores
  
  return encodedName + extension;
}

/**
 * Creates a unique file path for storage
 */
export function createUniqueFilePath(
  userId: string,
  originalFileName: string,
  folder?: string
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sanitizedName = sanitizeFileName(originalFileName);
  
  const basePath = `${userId}${folder ? `/${folder}` : ''}`;
  return `${basePath}/${timestamp}-${sanitizedName}`;
}

/**
 * Formats file size in human readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}