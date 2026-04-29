#!/usr/bin/env node

/**
 * Test native messaging protocol
 * 
 * This simulates what Firefox does:
 * 1. Writes a message with 4-byte length header
 * 2. Reads the response
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const host = spawn(process.execPath, [path.join(__dirname, 'index.js')]);

// Read responses from native host
let responseBuffer = Buffer.alloc(0);

host.stdout.on('data', (chunk) => {
  responseBuffer = Buffer.concat([responseBuffer, chunk]);
  console.log('Received chunk:', chunk.length, 'bytes');
  
  // Try to parse response
  if (responseBuffer.length >= 4) {
    const messageLength = responseBuffer.readUInt32LE(0);
    console.log('Expected message length:', messageLength);
    
    if (responseBuffer.length >= 4 + messageLength) {
      const messageBuffer = responseBuffer.slice(4, 4 + messageLength);
      const message = JSON.parse(messageBuffer.toString('utf8'));
      console.log('Received response:', message);
      responseBuffer = responseBuffer.slice(4 + messageLength);
    }
  }
});

host.stderr.on('data', (data) => {
  console.log('stderr:', data.toString());
});

host.on('exit', (code) => {
  console.log('Native host exited with code:', code);
  process.exit(code);
});

// Wait a bit for startup
setTimeout(() => {
  console.log('Sending test message...');
  
  // Send a test message
  const testMessage = {
    kind: 'PARSE_RESUME',
    requestId: 'test-123',
    resumeText: 'John Doe\njohn@example.com\nSoftware Engineer'
  };
  
  const json = JSON.stringify(testMessage);
  const length = Buffer.byteLength(json, 'utf8');
  const buffer = Buffer.alloc(4 + length);
  buffer.writeUInt32LE(length, 0);
  buffer.write(json, 4, length, 'utf8');
  
  console.log('Sending', length, 'bytes');
  host.stdin.write(buffer);
  
  // Wait for response
  setTimeout(() => {
    console.log('Closing...');
    host.stdin.end();
  }, 5000);
}, 1000);
