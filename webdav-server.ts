#!/usr/bin/env node
/**
 * Local WebDAV Test Server
 * For testing WebDAV functionality without external dependencies
 * 
 * Usage:
 *   npx tsx webdav-server.ts [port]
 *   
 * Default port: 1900
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { Buffer } from 'buffer';

const PORT = parseInt(process.argv[2]) || 1900;
const DATA_DIR = path.join(process.cwd(), '.webdav-test-data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Basic auth credentials
const AUTH_USER = 'test';
const AUTH_PASS = 'test';

function checkAuth(req: http.IncomingMessage): boolean {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    return false;
  }
  
  const credentials = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
  const [user, pass] = credentials.split(':');
  return user === AUTH_USER && pass === AUTH_PASS;
}

function getFilePath(urlPath: string): string {
  // Remove leading slash and ensure safe path
  const cleanPath = urlPath.replace(/^\/+/, '').replace(/\.\./g, '');
  return path.join(DATA_DIR, cleanPath);
}

function generatePropResponse(filePath: string, href: string): string {
  const stats = fs.statSync(filePath);
  const isDir = stats.isDirectory();
  
  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${href}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${path.basename(filePath)}</D:displayname>
        <D:getcontentlength>${isDir ? 0 : stats.size}</D:getcontentlength>
        <D:getlastmodified>${stats.mtime.toUTCString()}</D:getlastmodified>
        <D:resourcetype>${isDir ? '<D:collection/>' : ''}</D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
}

const server = http.createServer((req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, PROPFIND, MKCOL, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // Check authentication
  if (!checkAuth(req)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="WebDAV Test Server"',
      'Content-Type': 'text/plain'
    });
    res.end('Authentication required');
    return;
  }
  
  const filePath = getFilePath(req.url || '/');
  const href = req.url || '/';
  
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  
  switch (req.method) {
    case 'PROPFIND': {
      // List directory or get file properties
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        // List directory contents
        const files = fs.readdirSync(filePath);
        let responses = generatePropResponse(filePath, href);
        
        for (const file of files) {
          const childPath = path.join(filePath, file);
          const childHref = path.join(href, file);
          responses = responses.replace('</D:multistatus>', 
            generatePropResponse(childPath, childHref).replace(/<\?xml.*\?>/, '') + 
            '</D:multistatus>');
        }
        
        res.writeHead(207, { 'Content-Type': 'application/xml' });
        res.end(responses);
      } else {
        // Single file properties
        res.writeHead(207, { 'Content-Type': 'application/xml' });
        res.end(generatePropResponse(filePath, href));
      }
      break;
    }
    
    case 'GET': {
      // Download file
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 
        'Content-Type': 'application/octet-stream',
        'Content-Length': content.length
      });
      res.end(content);
      break;
    }
    
    case 'PUT': {
      // Upload file
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const content = Buffer.concat(chunks);
        fs.writeFileSync(filePath, content);
        res.writeHead(201, { 'Content-Type': 'text/plain' });
        res.end('Created');
        console.log(`  Uploaded ${content.length} bytes`);
      });
      break;
    }
    
    case 'DELETE': {
      // Delete file or directory
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        fs.rmSync(filePath, { recursive: true });
      } else {
        fs.unlinkSync(filePath);
      }
      
      res.writeHead(204);
      res.end();
      console.log(`  Deleted ${stats.isDirectory() ? 'directory' : 'file'}`);
      break;
    }
    
    case 'MKCOL': {
      // Create directory
      if (fs.existsSync(filePath)) {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Already exists');
        return;
      }
      
      fs.mkdirSync(filePath, { recursive: true });
      res.writeHead(201, { 'Content-Type': 'text/plain' });
      res.end('Created');
      console.log(`  Created directory`);
      break;
    }
    
    default:
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method not allowed');
  }
});

server.listen(PORT, () => {
  console.log(`🌐 WebDAV Test Server running on http://localhost:${PORT}`);
  console.log(`📁 Data directory: ${DATA_DIR}`);
  console.log(`🔐 Credentials: ${AUTH_USER}:${AUTH_PASS}`);
  console.log('');
  console.log('Test commands:');
  console.log(`  zotero webdav:config http://localhost:${PORT}/zotero test test`);
  console.log(`  zotero webdav:sync`);
  console.log('');
  console.log('Press Ctrl+C to stop');
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down server...');
  server.close(() => {
    console.log('✅ Server stopped');
    process.exit(0);
  });
});
