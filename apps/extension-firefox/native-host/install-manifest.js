#!/usr/bin/env node

/**
 * Install Native Host Manifest for Firefox
 * 
 * This script:
 * 1. Gets the Firefox extension ID from the user
 * 2. Creates the native host manifest
 * 3. Installs it to the correct location for Firefox
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NATIVE_HOST_NAME = 'ai.offlyn.helper';
const LAUNCHER_PATH = path.resolve(__dirname, 'launcher.sh');

/**
 * Get Firefox manifest directory based on OS
 */
function getManifestDir() {
  const platform = os.platform();
  const homeDir = os.homedir();
  
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library/Application Support/Mozilla/NativeMessagingHosts');
  } else if (platform === 'linux') {
    return path.join(homeDir, '.mozilla/native-messaging-hosts');
  } else if (platform === 'win32') {
    // Windows requires registry, not supported yet
    throw new Error('Windows is not supported yet. Please manually install the manifest.');
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Create native host manifest
 */
function createManifest(extensionId) {
  return {
    name: NATIVE_HOST_NAME,
    description: 'Offlyn Apply desktop bridge for job application automation via Ollama',
    type: 'stdio',
    path: LAUNCHER_PATH,
    allowed_extensions: [extensionId],
  };
}

/**
 * Main installation
 */
function install() {
  console.log('Offlyn Apply Native Host Installer\n');
  
  // Check if launcher exists
  if (!fs.existsSync(LAUNCHER_PATH)) {
    console.error('[FAIL] Error: launcher.sh not found');
    console.error('   Expected:', LAUNCHER_PATH);
    process.exit(1);
  }
  
  // Check if index.js exists
  const indexPath = path.join(__dirname, 'index.js');
  if (!fs.existsSync(indexPath)) {
    console.error('[FAIL] Error: index.js not found');
    console.error('   Expected:', indexPath);
    process.exit(1);
  }
  
  // Prompt for extension ID
  console.log('To get your Firefox extension ID:');
  console.log('   1. Open Firefox');
  console.log('   2. Go to about:debugging');
  console.log('   3. Click "This Firefox"');
  console.log('   4. Find "Offlyn Apply" extension');
  console.log('   5. Copy the Internal UUID (e.g., {12345678-1234-1234-1234-123456789abc})');
  console.log('');
  
  // For now, use a default ID or read from stdin
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  rl.question('Enter your extension ID: ', (extensionId) => {
    rl.close();
    
    if (!extensionId.trim()) {
      console.error('[FAIL] Extension ID required');
      process.exit(1);
    }
    
    extensionId = extensionId.trim();
    
    try {
      // Create manifest directory if it doesn't exist
      const manifestDir = getManifestDir();
      if (!fs.existsSync(manifestDir)) {
        fs.mkdirSync(manifestDir, { recursive: true });
        console.log('[OK] Created manifest directory:', manifestDir);
      }
      
      // Create manifest
      const manifest = createManifest(extensionId);
      const manifestPath = path.join(manifestDir, `${NATIVE_HOST_NAME}.json`);
      
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      console.log('[OK] Installed manifest:', manifestPath);
      
      // Make launcher executable
      fs.chmodSync(LAUNCHER_PATH, 0o755);
      fs.chmodSync(indexPath, 0o755);
      console.log('[OK] Made launcher executable');
      
      console.log('\n[OK] Installation complete!');
      console.log('\nNext steps:');
      console.log('   1. Reload the extension in Firefox (about:debugging)');
      console.log('   2. Check the background script console for "Connected to native host"');
      console.log('   3. Visit a job application page to test');
      console.log('\nLogs: native-host/native-host.log');
      
    } catch (err) {
      console.error('[FAIL] Installation failed:', err.message);
      process.exit(1);
    }
  });
}

install();
