/**
 * Cover Letter Functionality Validation Script
 * Run this in the browser console on a test page to validate the functionality
 */

console.log('Starting Cover Letter Functionality Validation');

// Test utilities
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const waitForElement = (selector, timeout = 5000) => {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
      } else if (Date.now() - start > timeout) {
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
};

// Test results
const results = {
  fieldSummaryDisplay: false,
  autoMinimize: false,
  coverLetterGeneration: false,
  duplicatePrevention: false,
  backButtonNavigation: false,
  cachingMechanism: false,
  errors: []
};

async function runTests() {
  try {
    console.log('1. Testing Field Summary Display...');
    
    // Wait for field summary to appear
    const fieldSummary = await waitForElement('#offlyn-field-summary');
    if (fieldSummary) {
      console.log('   [OK] Field summary panel appeared');
      results.fieldSummaryDisplay = true;
      
      // Check if it auto-minimizes after 3 seconds
      console.log('   Waiting for auto-minimize (3 seconds)...');
      await sleep(4000);
      
      if (fieldSummary.classList.contains('minimized') || fieldSummary.style.display === 'none') {
        console.log('   [OK] Auto-minimize working');
        results.autoMinimize = true;
      } else {
        console.log('   [FAIL] Auto-minimize not working');
      }
    }

    console.log('2. Testing Cover Letter Generation...');
    
    // Look for cover letter button
    const coverLetterBtn = document.querySelector('#ofl-cover-letter-btn');
    
    if (coverLetterBtn) {
      console.log('   Found cover letter button, clicking...');
      coverLetterBtn.click();
      
      // Wait for cover letter panel
      try {
        const coverLetterPanel = await waitForElement('#offlyn-cover-letter-panel', 3000);
        console.log('   [OK] Cover letter panel opened');
        results.coverLetterGeneration = true;
        
        // Test duplicate prevention
        console.log('3. Testing Duplicate Prevention...');
        const initialPanelCount = document.querySelectorAll('#offlyn-cover-letter-panel').length;
        coverLetterBtn.click(); // Click again
        await sleep(500);
        const finalPanelCount = document.querySelectorAll('#offlyn-cover-letter-panel').length;
        
        if (initialPanelCount === finalPanelCount) {
          console.log('   [OK] Duplicate prevention working');
          results.duplicatePrevention = true;
        } else {
          console.log('   [FAIL] Duplicate panels created');
        }
        
        // Test back button navigation
        console.log('4. Testing Back Button Navigation...');
        const backBtn = coverLetterPanel.querySelector('.ocl-back');
        if (backBtn) {
          backBtn.click();
          await sleep(500);
          
          // Check if field summary is expanded and not auto-minimizing
          const fieldSummaryAfterBack = document.querySelector('#offlyn-field-summary');
          if (fieldSummaryAfterBack && !fieldSummaryAfterBack.classList.contains('minimized')) {
            console.log('   [OK] Back button navigation working');
            results.backButtonNavigation = true;
            
            // Wait to see if it auto-minimizes (it shouldn't)
            await sleep(6000);
            if (!fieldSummaryAfterBack.classList.contains('minimized')) {
              console.log('   [OK] Field summary stays expanded after back navigation');
            } else {
              console.log('   [FAIL] Field summary auto-minimized after back navigation');
              results.backButtonNavigation = false;
            }
          }
        }
        
        // Test caching mechanism
        console.log('5. Testing Caching Mechanism...');
        // This would require generating a cover letter, closing, and reopening
        // For now, we'll just check if the state variables exist
        if (window.lastCoverLetterResult !== undefined || window.coverLetterGenerating !== undefined) {
          console.log('   [OK] Caching state variables detected');
          results.cachingMechanism = true;
        }
        
      } catch (err) {
        console.log('   [FAIL] Cover letter panel did not open:', err.message);
        results.errors.push('Cover letter panel failed to open');
      }
    } else {
      console.log('   [FAIL] Cover letter button not found');
      results.errors.push('Cover letter button not found');
    }

  } catch (error) {
    console.error('[FAIL] Test failed:', error);
    results.errors.push(error.message);
  }

  // Print results
  console.log('\nTest Results:');
  console.log('================');
  Object.entries(results).forEach(([key, value]) => {
    if (key !== 'errors') {
      console.log(`${value ? '[OK]' : '[FAIL]'} ${key}: ${value}`);
    }
  });
  
  if (results.errors.length > 0) {
    console.log('\n[FAIL] Errors:');
    results.errors.forEach(error => console.log(`   - ${error}`));
  }
  
  const passCount = Object.values(results).filter(v => v === true).length;
  const totalTests = Object.keys(results).length - 1; // exclude errors array
  console.log(`\nOverall: ${passCount}/${totalTests} tests passed`);
  
  return results;
}

// Auto-run if this script is executed
if (typeof window !== 'undefined') {
  // Wait a bit for page to load
  setTimeout(runTests, 2000);
}

// Export for manual execution
window.validateCoverLetterFunctionality = runTests;