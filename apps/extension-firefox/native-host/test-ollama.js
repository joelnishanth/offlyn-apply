#!/usr/bin/env node

/**
 * Test Ollama connection from native host
 */

const OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_MODEL = 'llama3.2';

async function testOllama() {
  console.log('Testing Ollama Connection\n');
  
  try {
    // Test 1: Check version
    console.log('1. Checking Ollama version...');
    const versionRes = await fetch(`${OLLAMA_URL}/api/version`);
    const version = await versionRes.json();
    console.log('   [OK] Ollama version:', version.version);
    
    // Test 2: Check model availability
    console.log('\n2. Checking model availability...');
    const tagsRes = await fetch(`${OLLAMA_URL}/api/tags`);
    const tags = await tagsRes.json();
    const hasModel = tags.models.some(m => m.name.startsWith(OLLAMA_MODEL));
    if (hasModel) {
      console.log(`   [OK] Model ${OLLAMA_MODEL} is available`);
    } else {
      console.log(`   [FAIL] Model ${OLLAMA_MODEL} not found`);
      console.log('   Tip: Run: ollama pull llama3.2');
      process.exit(1);
    }
    
    // Test 3: Simple completion
    console.log('\n3. Testing chat completion...');
    const chatRes = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: 'Say "hello" in one word.' }],
        stream: false,
      }),
    });
    
    if (!chatRes.ok) {
      throw new Error(`HTTP ${chatRes.status}: ${chatRes.statusText}`);
    }
    
    const chat = await chatRes.json();
    const reply = chat.choices[0].message.content;
    console.log('   [OK] Response:', reply.trim());
    
    console.log('\n[OK] All tests passed! Native host is ready.');
    console.log('\nNext: Run install-manifest.js to set up Firefox integration');
    
  } catch (err) {
    console.error('\n[FAIL] Test failed:', err.message);
    console.error('\nTroubleshooting:');
    console.error('   1. Check Ollama is running: open /Applications/Ollama.app (macOS)');
    console.error('   2. Check model is pulled: ollama list');
    console.error('   3. Try manual test: curl http://localhost:11434/api/version');
    process.exit(1);
  }
}

testOllama();
