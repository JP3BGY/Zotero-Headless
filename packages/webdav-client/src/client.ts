// WebDAV Client for Zotero-Headless
// Supports file upload, download, delete, and list operations

import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';

export interface WebDAVConfig {
  url: string;
  username: string;
  password: string;
  basePath?: string;
}

export interface WebDAVFileInfo {
  filename: string;
  path: string;
  size: number;
  lastModified: Date;
  contentType?: string;
  isDirectory: boolean;
}

export interface WebDAVClientOptions {
  timeout?: number;
  maxRetries?: number;
}

export class WebDAVClient {
  private config: WebDAVConfig;
  private baseUrl: URL;
  private timeout: number;
  private maxRetries: number;

  constructor(config: WebDAVConfig, options: WebDAVClientOptions = {}) {
    this.config = config;
    this.baseUrl = new URL(config.url);
    this.timeout = options.timeout || 30000; // 30s default
    this.maxRetries = options.maxRetries || 3;
  }

  /**
   * Join URL path parts (always uses forward slashes for URLs)
   */
  private joinUrlPath(...parts: string[]): string {
    return parts
      .map(p => p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
      .filter(p => p)
      .join('/');
  }

  /**
   * Make a WebDAV request
   */
  private async request(
    method: string,
    filePath: string,
    options: {
      body?: string | Buffer;
      headers?: Record<string, string>;
    } = {}
  ): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    const urlPath = this.joinUrlPath(this.config.basePath || '/', filePath);
    const url = new URL(urlPath, this.baseUrl);

    const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');

    return new Promise((resolve, reject) => {
      const reqOptions: any = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: method,
        timeout: this.timeout,
        headers: {
          'Authorization': `Basic ${auth}`,
          ...options.headers,
        },
      };

      if (url.protocol === 'https:') {
        reqOptions.agent = new https.Agent({ rejectUnauthorized: false }); // Allow self-signed certs
      }

      const req = (url.protocol === 'https:' ? https : http).request(reqOptions, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          const headers: Record<string, string> = {};
          Object.entries(res.headers).forEach(([k, v]) => {
            if (v) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
          });
          resolve({ status: res.statusCode || 0, headers, body });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timeout after ${this.timeout}ms`));
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  /**
   * Check if file exists
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      const res = await this.request('HEAD', filePath);
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Upload a file
   */
  async uploadFile(localPath: string, remotePath: string, onProgress?: (uploaded: number, total: number) => void): Promise<void> {
    const fileBuffer = fs.readFileSync(localPath);
    const fileSize = fileBuffer.length;
    
    await this.request('PUT', remotePath, {
      body: fileBuffer,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileSize.toString(),
      },
    });

    if (onProgress) {
      onProgress(fileSize, fileSize);
    }
  }

  /**
   * Download a file
   */
  async downloadFile(remotePath: string, localPath: string, onProgress?: (downloaded: number, total: number) => void): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const urlPath = this.joinUrlPath(this.config.basePath || '/', remotePath);
      const url = new URL(urlPath, this.baseUrl);
      const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');

      const reqOptions: any = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'GET',
        timeout: this.timeout,
        headers: {
          'Authorization': `Basic ${auth}`,
        },
      };

      if (url.protocol === 'https:') {
        reqOptions.agent = new https.Agent({ rejectUnauthorized: false });
      }

      const req = (url.protocol === 'https:' ? https : http).request(reqOptions, (res) => {
        if (res.statusCode === 404) {
          reject(new Error(`File not found: ${remotePath}`));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode}`));
          return;
        }

        const totalSize = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;

        // Ensure directory exists
        const dir = path.dirname(localPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const file = fs.createWriteStream(localPath);
        
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (onProgress) {
            onProgress(downloaded, totalSize);
          }
        });

        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Download timeout after ${this.timeout}ms`));
      });
      req.end();
    });
  }

  /**
   * Delete a file
   */
  async deleteFile(remotePath: string): Promise<void> {
    const res = await this.request('DELETE', remotePath);
    if (res.status !== 200 && res.status !== 204) {
      throw new Error(`Delete failed: ${res.status}`);
    }
  }

  /**
   * List files in a directory
   */
  async listFiles(dirPath: string = '/'): Promise<WebDAVFileInfo[]> {
    const res = await this.request('PROPFIND', dirPath, {
      body: `<?xml version="1.0"?>
        <d:propfind xmlns:d="DAV:">
          <d:prop>
            <d:displayname/>
            <d:getcontentlength/>
            <d:getlastmodified/>
            <d:getcontenttype/>
            <d:resourcetype/>
          </d:prop>
        </d:propfind>`,
      headers: {
        'Content-Type': 'application/xml',
      },
    });

    if (res.status !== 207) {
      throw new Error(`PROPFIND failed: ${res.status}`);
    }

    // Parse XML response
    const files: WebDAVFileInfo[] = [];
    const multistatus = res.body;
    
    // Simple XML parsing (use a proper parser in production)
    const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/g;
    let match;
    
    while ((match = responseRegex.exec(multistatus)) !== null) {
      const response = match[1];
      
      const hrefMatch = response.match(/<d:href>([^<]+)<\/d:href>/);
      const href = hrefMatch ? hrefMatch[1] : '';
      
      // Skip the base directory itself
      const normalizedPath = href.replace(/\/$/, '');
      const basePath = this.config.basePath || '/';
      if (normalizedPath === basePath || normalizedPath === basePath + '/') {
        continue;
      }
      
      const displayNameMatch = response.match(/<d:displayname>([^<]*)<\/d:displayname>/);
      const filename = displayNameMatch ? displayNameMatch[1] : path.basename(href);
      
      const contentLengthMatch = response.match(/<d:getcontentlength>(\d+)<\/d:getcontentlength>/);
      const size = contentLengthMatch ? parseInt(contentLengthMatch[1], 10) : 0;
      
      const lastModifiedMatch = response.match(/<d:getlastmodified>([^<]+)<\/d:getlastmodified>/);
      const lastModified = lastModifiedMatch ? new Date(lastModifiedMatch[1]) : new Date();
      
      const contentTypeMatch = response.match(/<d:getcontenttype>([^<]*)<\/d:getcontenttype>/);
      const contentType = contentTypeMatch ? contentTypeMatch[1] : undefined;
      
      const isDirectory = response.includes('<d:collection/>');
      
      // Calculate relative path
      const relativePath = href.startsWith(basePath) ? href.substring(basePath.length) : href;
      
      files.push({
        filename: decodeURIComponent(filename),
        path: decodeURIComponent(relativePath),
        size,
        lastModified,
        contentType,
        isDirectory,
      });
    }

    return files;
  }

  /**
   * Create a directory
   */
  async createDirectory(dirPath: string): Promise<void> {
    const res = await this.request('MKCOL', dirPath);
    if (res.status !== 201 && res.status !== 409) {
      // 409 means already exists
      throw new Error(`MKCOL failed: ${res.status}`);
    }
  }

  /**
   * Test connection
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await this.request('OPTIONS', '/');
      if (res.status === 200) {
        return { success: true };
      }
      return { success: false, error: `Status: ${res.status}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

export function createWebDAVClient(config: WebDAVConfig, options?: WebDAVClientOptions): WebDAVClient {
  return new WebDAVClient(config, options);
}
