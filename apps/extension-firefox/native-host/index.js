#!/usr/bin/env node

/**
 * Offlyn Apply Native Host - Firefox Native Messaging Bridge
 * 
 * Connects Firefox extension to Ollama for:
 * - Resume parsing
 * - Form field mapping
 * - Job application automation
 * 
 * Protocol: JSON messages via stdin/stdout (Native Messaging)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = path.join(__dirname, 'native-host.log');
const OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_MODEL = 'llama3.2';

/**
 * Log to file (stderr goes to Firefox console, stdout is for messages)
 * Using synchronous writes to ensure logs are persisted even if process crashes
 */
function log(...args) {
  const timestamp = new Date().toISOString();
  const message = `${timestamp} ${args.join(' ')}\n`;
  try {
    fs.appendFileSync(LOG_FILE, message, { flag: 'a' });
    // Also log to stderr so it appears in Firefox console
    process.stderr.write(`[NATIVE] ${message}`);
  } catch (err) {
    process.stderr.write(`[NATIVE] ERROR: Failed to log: ${err.message}\n`);
  }
}

/**
 * Send message to extension via stdout
 */
function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const length = Buffer.byteLength(json, 'utf8');
  
  // Native messaging format: 4-byte length header + JSON message
  const buffer = Buffer.alloc(4 + length);
  buffer.writeUInt32LE(length, 0);
  buffer.write(json, 4, length, 'utf8');
  
  process.stdout.write(buffer);
  log('SENT:', json.substring(0, 200));
}

/**
 * Call Ollama for LLM inference
 */
async function callOllama(prompt, systemPrompt = null) {
  try {
    log('callOllama: starting request to Ollama...');
    const messages = [];
    
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    
    messages.push({ role: 'user', content: prompt });
    
    log('callOllama: sending POST request...');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    const response = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        temperature: 0.1, // Low temperature for structured output
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    log('callOllama: received response, status:', response.status);
    
    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    log('callOllama: parsed JSON response');
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      log('ERROR: No content in response:', JSON.stringify(data).substring(0, 200));
      throw new Error('No response from Ollama');
    }
    
    log('callOllama: success, content length:', content.length);
    return content;
  } catch (err) {
    log('ERROR calling Ollama:', err.message, err.stack);
    throw err;
  }
}

/**
 * Parse resume and generate user profile
 */
async function parseResume(resumeText) {
  const systemPrompt = `You are a resume parser. Extract structured information and return ONLY valid JSON.
Never include markdown, explanations, or any text outside the JSON object.`;
  
  const userPrompt = `Extract information from this resume and return a JSON object with this exact structure:

{
  "personal": {
    "firstName": "string",
    "lastName": "string", 
    "email": "string",
    "phone": "string",
    "location": "string"
  },
  "professional": {
    "linkedin": "string or empty",
    "github": "string or empty",
    "portfolio": "string or empty",
    "yearsOfExperience": number or 0
  },
  "skills": ["skill1", "skill2"],
  "work": [{"company": "string", "title": "string", "startDate": "string", "endDate": "string", "current": false, "description": "string"}],
  "education": [{"school": "string", "degree": "string", "field": "string", "graduationYear": "string"}],
  "summary": "string"
}

Resume text:
${resumeText}

Return ONLY the JSON object, nothing else:`;
  
  const response = await callOllama(userPrompt, systemPrompt);
  
  log('Raw Ollama response:', response.substring(0, 500));
  
  // Try to extract JSON from response (in case model adds markdown or text)
  let jsonStr = response.trim();
  
  // Remove markdown code blocks if present
  jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '');
  
  // Find JSON object
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    log('ERROR: No JSON found in response:', response);
    throw new Error('Could not find JSON in response');
  }
  
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    log('ERROR: JSON parse failed:', err.message);
    log('Attempted to parse:', jsonMatch[0].substring(0, 500));
    throw new Error('Invalid JSON in response: ' + err.message);
  }
}

/**
 * Map form fields to user data
 */
async function mapFormFields(schema, userData) {
  const systemPrompt = `You are a form-filling assistant. Map user data to form fields.
Output valid JSON only: {"mappings": [{"selector": "...", "value": "..."}]}`;
  
  const fieldsDescription = schema.map(f => 
    `${f.selector}: ${f.label || f.name || f.id} (${f.type}${f.required ? ', required' : ''})`
  ).join('\n');
  
  const userPrompt = `Given these form fields:
${fieldsDescription}

And this user data:
${JSON.stringify(userData, null, 2)}

Generate field mappings. Output JSON only:`;
  
  const response = await callOllama(userPrompt, systemPrompt);
  
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  
  return JSON.parse(response);
}

/**
 * Handle messages from extension
 */
/**
 * Lock down Ollama CORS to a specific moz-extension:// UUID.
 * Updates launchctl env, the LaunchAgent plist, then restarts Ollama.
 */
function lockOllamaCors(uuid) {
  const origin = `moz-extension://${uuid}`;
  log('lock_cors: locking OLLAMA_ORIGINS to', origin);

  try {
    execSync(`launchctl setenv OLLAMA_ORIGINS '${origin}'`, { stdio: 'ignore' });
    log('lock_cors: launchctl setenv done');
  } catch (e) {
    log('lock_cors: launchctl setenv failed (non-fatal):', e.message);
  }

  const plist = path.join(
    process.env.HOME || '',
    'Library/LaunchAgents/com.ollama.ollama.plist',
  );
  if (fs.existsSync(plist)) {
    try {
      execSync(
        `/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables dict" '${plist}' 2>/dev/null; ` +
        `/usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:OLLAMA_ORIGINS '${origin}'" '${plist}' 2>/dev/null || ` +
        `/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:OLLAMA_ORIGINS string '${origin}'" '${plist}'`,
        { shell: '/bin/bash', stdio: 'ignore' },
      );
      log('lock_cors: plist updated');
    } catch (e) {
      log('lock_cors: plist update failed (non-fatal):', e.message);
    }
  }

  try {
    execSync("pkill -f 'ollama serve' 2>/dev/null; sleep 1", { shell: '/bin/bash', stdio: 'ignore' });
    execSync(
      `OLLAMA_ORIGINS='${origin}' /Applications/Ollama.app/Contents/Resources/ollama serve &>/dev/null &`,
      { shell: '/bin/bash', stdio: 'ignore', timeout: 3000 },
    );
    log('lock_cors: Ollama restarted with locked-down origin');
  } catch (e) {
    log('lock_cors: restart attempted (may timeout as expected):', e.message);
  }

  return origin;
}

async function handleMessage(msg) {
  try {
    log('RECEIVED:', JSON.stringify(msg).substring(0, 200));

    // ── ping (used by CHECK_NATIVE_HELPER) ──
    if (msg.cmd === 'ping') {
      sendMessage({ type: 'pong', version: '0.9.0' });
      return;
    }

    // ── CORS lockdown: receives the moz-extension UUID, locks Ollama to it ──
    if (msg.cmd === 'lock_cors') {
      const uuid = msg.uuid;
      if (!uuid || typeof uuid !== 'string') {
        sendMessage({ type: 'error', message: 'lock_cors: missing uuid' });
        return;
      }
      const origin = lockOllamaCors(uuid);
      sendMessage({ type: 'cors_locked', origin });
      return;
    }

    // ── run_setup (used by RUN_OLLAMA_SETUP) ──
    if (msg.cmd === 'run_setup') {
      sendMessage({ type: 'progress', step: 'starting', message: 'Starting Ollama setup...' });
      // Delegate to the DMG installer flow; this is a stub for now
      sendMessage({ type: 'done', success: true });
      return;
    }

    if (msg.kind === 'EXT_EVENT') {
      const event = msg.payload;
      
      if (event.kind === 'JOB_APPLY_EVENT') {
        log(`Job event: ${event.eventType} - ${event.jobMeta.jobTitle} at ${event.jobMeta.company}`);
        
        // For now, just acknowledge
        sendMessage({
          kind: 'ACK',
          requestId: msg.timestamp,
          message: 'Job event received',
        });
        
        // TODO: Load user resume, parse it, map to form fields, send FILL_PLAN
        // For now, we'll implement this when needed
      }
    } else if (msg.kind === 'PARSE_RESUME') {
      // Parse resume text
      log('Parsing resume, length:', msg.resumeText?.length || 0);
      
      try {
        const profile = await parseResume(msg.resumeText);
        log('Successfully parsed profile:', JSON.stringify(profile).substring(0, 200));
        
        sendMessage({
          kind: 'RESUME_PARSED',
          requestId: msg.requestId,
          profile,
        });
      } catch (err) {
        log('ERROR parsing resume:', err.message, err.stack);
        sendMessage({
          kind: 'ERROR',
          requestId: msg.requestId,
          message: 'Failed to parse resume: ' + err.message,
        });
      }
    } else if (msg.kind === 'MAP_FIELDS') {
      // Map form fields to user data
      const result = await mapFormFields(msg.schema, msg.userData);
      
      sendMessage({
        kind: 'FIELDS_MAPPED',
        requestId: msg.requestId,
        mappings: result.mappings,
      });
    } else {
      log('Unknown message kind:', msg.kind);
    }
  } catch (err) {
    log('ERROR handling message:', err.message, err.stack);
    
    sendMessage({
      kind: 'ERROR',
      requestId: msg.requestId || msg.timestamp,
      message: err.message,
    });
  }
}

/**
 * Read messages from stdin (Native Messaging protocol)
 */
function readStdin() {
  let buffer = Buffer.alloc(0);
  let messageLength = null;
  
  log('readStdin: setting up stdin listeners...');
  
  process.stdin.on('data', (chunk) => {
    log('Received', chunk.length, 'bytes from stdin');
    buffer = Buffer.concat([buffer, chunk]);
    
    // Read message length from first 4 bytes
    while (buffer.length >= 4) {
      if (messageLength === null) {
        messageLength = buffer.readUInt32LE(0);
        log('Expecting message of length:', messageLength);
        buffer = buffer.slice(4);
      }
      
      // Check if we have the full message
      if (buffer.length >= messageLength) {
        const messageBuffer = buffer.slice(0, messageLength);
        buffer = buffer.slice(messageLength);
        
        try {
          const message = JSON.parse(messageBuffer.toString('utf8'));
          handleMessage(message);
        } catch (err) {
          log('ERROR parsing message:', err.message);
        }
        
        messageLength = null;
      } else {
        log('Waiting for more data, have', buffer.length, 'of', messageLength);
        break;
      }
    }
  });
  
  let stdinEndReceived = false;
  
  process.stdin.on('end', () => {
    if (stdinEndReceived) return;
    stdinEndReceived = true;
    
    log('stdin END event received - waiting 2 seconds before exit...');
    
    // Give Firefox a chance - maybe it's just a temporary hiccup
    setTimeout(() => {
      log('Grace period expired, exiting');
      process.exit(0);
    }, 2000);
  });
  
  process.stdin.on('close', () => {
    log('stdin CLOSE event received - stream closed');
    // Don't exit immediately, let the END handler deal with it
  });
  
  process.stdin.on('error', (err) => {
    log('stdin ERROR event:', err.message);
    process.exit(1);
  });
  
  log('readStdin: listeners installed, ready for messages');
}

/**
 * Initialize native host
 */
function init() {
  log('===== NATIVE HOST STARTING =====');
  log('PID:', process.pid);
  log('PWD:', process.cwd());
  log('Node version:', process.version);
  log('Ollama URL:', OLLAMA_URL);
  log('Ollama model:', OLLAMA_MODEL);
  log('stdin isTTY:', process.stdin.isTTY);
  log('stdin readable:', process.stdin.readable);
  
  // IMPORTANT: Start reading stdin FIRST before doing anything else
  readStdin();
  
  // Keep stdin open and prevent Node from exiting
  process.stdin.resume();
  
  // Prevent process from exiting
  const keepAlive = setInterval(() => {
    // Do nothing, just keep process alive
  }, 60000);
  
  // Clean up interval on exit
  process.on('exit', () => {
    log('Process exiting, code:', process.exitCode);
    clearInterval(keepAlive);
  });
  
  // Test Ollama connection (async, doesn't block)
  fetch(`${OLLAMA_URL}/api/version`)
    .then(res => res.json())
    .then(data => log('Ollama version:', data.version))
    .catch(err => log('WARNING: Ollama not reachable:', err.message));
  
  log('===== INITIALIZATION COMPLETE =====');
}

// Handle errors
process.on('uncaughtException', (err) => {
  log('FATAL:', err.message, err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  log('UNHANDLED REJECTION:', err.message, err.stack);
});

init();
