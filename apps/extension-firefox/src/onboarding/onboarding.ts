/**
 * Onboarding page logic
 */

import type { UserProfile } from '../shared/profile';
import { saveUserProfile } from '../shared/profile';

// PDF.js is loaded via CDN in the HTML
declare const pdfjsLib: any;

let uploadedFile: File | null = null;
let extractedProfile: UserProfile | null = null;
let isConnected = false;

/**
 * Show a specific step
 */
function showStep(stepId: string): void {
  document.querySelectorAll('.step').forEach(step => {
    step.classList.remove('active');
  });
  const targetStep = document.getElementById(stepId);
  if (targetStep) {
    targetStep.classList.add('active');
  }
}

/**
 * Show status message
 */
function showStatus(type: 'info' | 'success' | 'error', message: string): void {
  const statusEl = document.getElementById('uploadStatus');
  if (!statusEl) return;
  
  statusEl.className = `status visible ${type}`;
  statusEl.textContent = message;
}

/**
 * Update progress bar
 */
function updateProgress(stage: 'read' | 'extract' | 'parse' | 'done', percent: number, message: string): void {
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  
  if (progressContainer && progressFill && progressText) {
    progressContainer.classList.add('visible');
    progressFill.style.width = `${percent}%`;
    progressText.textContent = message;
    
    // Update stage indicators
    const stages = ['read', 'extract', 'parse', 'done'];
    const currentIndex = stages.indexOf(stage);
    
    stages.forEach((s, index) => {
      const stageEl = document.getElementById(`stage-${s}`);
      if (stageEl) {
        stageEl.classList.remove('active', 'completed');
        if (index < currentIndex) {
          stageEl.classList.add('completed');
        } else if (index === currentIndex) {
          stageEl.classList.add('active');
        }
      }
    });
  }
}

/**
 * Hide progress bar
 */
function hideProgress(): void {
  const progressContainer = document.getElementById('progressContainer');
  if (progressContainer) {
    progressContainer.classList.remove('visible');
  }
}

/**
 * Show detailed error information
 */
function showErrorDetails(error: string, details?: any): void {
  const errorDetailsEl = document.getElementById('errorDetails');
  if (!errorDetailsEl) return;
  
  let html = '<div class="error-details">';
  html += '<h4>Error Details</h4>';
  html += `<p><strong>Error:</strong> ${error}</p>`;
  
  if (!isConnected) {
    html += '<p><strong>Issue:</strong> Native host is not connected</p>';
    html += '<p><strong>Solution:</strong></p>';
    html += '<ul>';
    html += '<li>Install the native host: <pre>cd native-host && node install-manifest.js</pre></li>';
    html += '<li>Restart Firefox after installation</li>';
    html += '<li>Reload this extension from <code>about:debugging</code></li>';
    html += '</ul>';
  } else {
    html += '<p><strong>Debugging Steps:</strong></p>';
    html += '<ul>';
    html += '<li>Open browser console (F12) and check for errors</li>';
    html += '<li>Check native host logs: <pre>tail -f native-host/native-host.log</pre></li>';
    html += '<li>Verify Ollama is running: <pre>ollama ps</pre></li>';
    html += '<li>Test Ollama directly: <pre>curl http://localhost:11434/v1/chat/completions ...</pre></li>';
    html += '</ul>';
  }
  
  if (details) {
    html += '<p><strong>Technical Details:</strong></p>';
    html += `<pre>${JSON.stringify(details, null, 2)}</pre>`;
  }
  
  html += '</div>';
  
  errorDetailsEl.innerHTML = html;
}

/**
 * Hide error details
 */
function hideErrorDetails(): void {
  const errorDetailsEl = document.getElementById('errorDetails');
  if (errorDetailsEl) {
    errorDetailsEl.innerHTML = '';
  }
}

/**
 * Update connection status display
 */
function updateConnectionStatus(connected: boolean): void {
  isConnected = connected;
  const statusEl = document.getElementById('connectionStatus');
  if (!statusEl) return;
  
  if (connected) {
    statusEl.className = 'connection-status connected';
    statusEl.innerHTML = '<span class="status-indicator connected"></span><span>Native Host Connected</span>';
  } else {
    statusEl.className = 'connection-status disconnected';
    statusEl.innerHTML = '<span class="status-indicator disconnected"></span><span>Native Host Not Connected - Install required</span>';
  }
}

/**
 * Check connection status
 */
async function checkConnection(): Promise<boolean> {
  try {
    const response = await browser.runtime.sendMessage({ kind: 'GET_CONNECTION_STATUS' });
    return response?.connected || false;
  } catch (err) {
    console.error('Failed to check connection:', err);
    return false;
  }
}

/**
 * Hide status message
 */
function hideStatus(): void {
  const statusEl = document.getElementById('uploadStatus');
  if (statusEl) {
    statusEl.classList.remove('visible');
  }
}

/**
 * Read file as text
 */
async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Extract text from PDF using PDF.js
 */
async function extractTextFromPDF(file: File): Promise<string> {
  try {
    // Configure PDF.js worker if not already set
    if (typeof pdfjsLib !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    
    updateProgress('extract', 30, 'Loading PDF...');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = '';
    const totalPages = pdf.numPages;
    
    // Extract text from all pages
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const progress = 30 + Math.floor((pageNum / totalPages) * 20);
      updateProgress('extract', progress, `Extracting text from page ${pageNum}/${totalPages}...`);
      
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      fullText += pageText + '\n\n';
    }
    
    return fullText.trim();
  } catch (err) {
    console.error('PDF extraction failed:', err);
    throw new Error('Failed to extract text from PDF: ' + (err instanceof Error ? err.message : 'Unknown error'));
  }
}

/**
 * Extract text from file based on type
 */
async function extractTextFromFile(file: File): Promise<string> {
  console.log('Extracting text from file:', file.name, 'Type:', file.type);
  
  if (file.type === 'text/plain') {
    return readFileAsText(file);
  }
  
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return extractTextFromPDF(file);
  }
  
  // For DOC/DOCX or unknown types, try plain text
  try {
    const text = await readFileAsText(file);
    
    // Check if it looks like PDF markup (starts with %PDF or has xref)
    if (text.includes('%PDF') || text.includes('xref')) {
      throw new Error('This appears to be a PDF file. Please save as .pdf or use a plain text resume.');
    }
    
    return text;
  } catch (err) {
    throw new Error('Failed to read file. Please use a PDF (.pdf) or plain text (.txt) resume.');
  }
}

/**
 * Parse resume using Ollama via background script
 */
async function parseResume(resumeText: string): Promise<UserProfile> {
  updateProgress('parse', 60, 'Sending to AI for parsing...');
  hideErrorDetails();
  
  try {
    console.log('Sending resume to background script, length:', resumeText.length);
    
    // Check connection first
    updateProgress('parse', 65, 'Checking Ollama connection...');
    const connected = await checkConnection();
    if (!connected) {
      throw new Error('Ollama not connected. Please ensure Ollama is running.');
    }
    
    // Send to background script which calls Ollama
    updateProgress('parse', 70, 'AI is analyzing your resume...');
    const response = await browser.runtime.sendMessage({
      kind: 'PARSE_RESUME',
      resumeText,
    });
    
    console.log('Received response:', response);
    
    if (response && response.kind === 'RESUME_PARSED' && response.profile) {
      console.log('Successfully parsed profile:', response.profile);
      updateProgress('done', 100, 'Parsing complete!');
      hideErrorDetails();
      return response.profile;
    } else if (response && response.kind === 'ERROR') {
      console.error('Parser error:', response.message);
      showErrorDetails(response.message || 'Failed to parse resume', response);
      throw new Error(response.message || 'Failed to parse resume');
    } else {
      console.error('Invalid response structure:', response);
      showErrorDetails('Invalid response from parser', response);
      throw new Error('Invalid response from parser. See details below.');
    }
  } catch (err) {
    console.error('Parse error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Failed to parse resume';
    if (!document.getElementById('errorDetails')?.innerHTML) {
      showErrorDetails(errorMessage);
    }
    throw new Error(errorMessage);
  }
}

/**
 * Handle file selection
 */
function handleFileSelect(file: File): void {
  if (file.size > 5 * 1024 * 1024) {
    showStatus('error', 'File too large. Please upload a file under 5MB.');
    return;
  }
  
  uploadedFile = file;
  
  // Show file info
  const fileInfo = document.getElementById('fileInfo');
  const fileName = document.getElementById('fileName');
  const fileSize = document.getElementById('fileSize');
  const parseBtn = document.getElementById('parseBtn') as HTMLButtonElement;
  
  if (fileInfo && fileName && fileSize && parseBtn) {
    fileInfo.classList.add('visible');
    fileName.textContent = file.name;
    fileSize.textContent = `${(file.size / 1024).toFixed(1)} KB`;
    parseBtn.disabled = false;
  }
  
  hideStatus();
}

/**
 * Escape HTML for safe display
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Render profile preview with editable fields
 */
/**
 * Build an input field, wrapped with an AI hint tile if the value is empty.
 */
function buildField(
  tag: 'input' | 'textarea',
  fieldName: string,
  value: string,
  attrs: string = '',
  placeholder: string = ''
): string {
  const isEmpty = !value || value.trim() === '' || value === '0';
  const escapedValue = escapeHtml(value);

  let inputHtml: string;
  if (tag === 'textarea') {
    const phAttr = placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : '';
    inputHtml = `<textarea class="profile-textarea" name="${fieldName}"${phAttr}${attrs}>${escapedValue}</textarea>`;
  } else {
    const phAttr = placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : '';
    inputHtml = `<input class="profile-input" name="${fieldName}" value="${escapedValue}"${phAttr}${attrs} />`;
  }

  if (isEmpty) {
    return (
      `<div class="input-wrapper">${inputHtml}` +
      `<div class="ai-suggest-tile" data-field="${fieldName}">` +
        `<span class="ai-sparkle">&#10024;</span>` +
        `<span class="ai-label">Ask AI to suggest</span>` +
      `</div></div>`
    );
  }
  return inputHtml;
}

function renderProfilePreview(profile: UserProfile): void {
  const preview = document.getElementById('profilePreview');
  if (!preview) return;
  
  let html = '<form id="profileForm">';
  
  // Personal info
  html += '<div class="profile-section">';
  html += '<h3>Personal Information</h3>';
  html += `<div class="profile-field"><label class="profile-label">First Name: <span class="required">*</span></label>${buildField('input', 'firstName', profile.personal.firstName || '', ' type="text" required')}</div>`;
  html += `<div class="profile-field"><label class="profile-label">Last Name: <span class="required">*</span></label>${buildField('input', 'lastName', profile.personal.lastName || '', ' type="text" required')}</div>`;
  html += `<div class="profile-field"><label class="profile-label">Email: <span class="required">*</span></label>${buildField('input', 'email', profile.personal.email || '', ' type="email" required')}</div>`;
  html += `<div class="profile-field"><label class="profile-label">Phone:</label>${buildField('input', 'phone', profile.personal.phone || '', ' type="tel"')}</div>`;
  html += `<div class="profile-field"><label class="profile-label">Location:</label>${buildField('input', 'location', profile.personal.location || '', ' type="text"')}</div>`;
  html += '</div>';
  
  // Professional links
  html += '<div class="profile-section">';
  html += '<h3>Professional Links</h3>';
  html += `<div class="profile-field"><label class="profile-label">LinkedIn:</label>${buildField('input', 'linkedin', profile.professional.linkedin || '', ' type="url"', 'https://linkedin.com/in/...')}</div>`;
  html += `<div class="profile-field"><label class="profile-label">GitHub:</label>${buildField('input', 'github', profile.professional.github || '', ' type="url"', 'https://github.com/...')}</div>`;
  html += `<div class="profile-field"><label class="profile-label">Portfolio:</label>${buildField('input', 'portfolio', profile.professional.portfolio || '', ' type="url"', 'https://...')}</div>`;
  html += `<div class="profile-field"><label class="profile-label">Years of Exp:</label>${buildField('input', 'yearsOfExperience', String(profile.professional.yearsOfExperience || 0), ' type="number" min="0"')}</div>`;
  html += '</div>';
  
  // Skills (editable list)
  html += '<div class="profile-section">';
  html += '<h3>Skills</h3>';
  html += '<div class="profile-field"><label class="profile-label">Skills:</label><div class="editable-list" id="skillsList">';
  if (profile.skills && profile.skills.length > 0) {
    profile.skills.forEach((skill, index) => {
      html += `<div class="editable-list-item" data-skill-index="${index}">`;
      html += `<input type="text" value="${escapeHtml(skill)}" />`;
      html += `<button type="button" class="remove-skill-btn">Remove</button>`;
      html += `</div>`;
    });
  }
  html += '</div></div>';
  html += '<button type="button" class="add-item-btn" id="addSkillBtn">Add Skill</button>';
  html += '</div>';
  
  // Work Experience (simplified display - work/education are complex, keep as read-only for now)
  if (profile.work && profile.work.length > 0) {
    html += '<div class="profile-section">';
    html += '<h3>Work Experience</h3>';
    profile.work.forEach(job => {
      html += `<div class="profile-value" style="margin-bottom: 12px; padding: 12px; background: #f9f9f9; border-radius: 4px;">`;
      html += `<strong>${escapeHtml(job.title)}</strong> at ${escapeHtml(job.company)}<br/>`;
      html += `<small style="color: #666;">${escapeHtml(job.startDate)} - ${job.current ? 'Present' : escapeHtml(job.endDate)}</small>`;
      if (job.description) {
        html += `<p style="margin-top: 8px; font-size: 13px; color: #666;">${escapeHtml(job.description)}</p>`;
      }
      html += '</div>';
    });
    html += '<p style="font-size: 12px; color: #999; margin-top: 8px;">Note: Work experience editing coming soon</p>';
    html += '</div>';
  }
  
  // Education (read-only for now)
  if (profile.education && profile.education.length > 0) {
    html += '<div class="profile-section">';
    html += '<h3>Education</h3>';
    profile.education.forEach(edu => {
      html += `<div class="profile-value" style="margin-bottom: 12px; padding: 12px; background: #f9f9f9; border-radius: 4px;">`;
      html += `<strong>${escapeHtml(edu.degree)}</strong> in ${escapeHtml(edu.field || 'N/A')}<br/>`;
      html += `<small style="color: #666;">${escapeHtml(edu.school)} - ${escapeHtml(edu.graduationYear)}</small>`;
      html += '</div>';
    });
    html += '<p style="font-size: 12px; color: #999; margin-top: 8px;">Note: Education editing coming soon</p>';
    html += '</div>';
  }
  
  // Summary
  html += '<div class="profile-section">';
  html += '<h3>Professional Summary</h3>';
  html += `<div class="profile-field"><label class="profile-label">Summary:</label>${buildField('textarea', 'summary', profile.summary || '', '', 'Brief professional summary...')}</div>`;
  html += '</div>';
  
  html += '</form>';
  
  preview.innerHTML = html;
  
  // Setup event listeners for skills
  setupSkillsEventListeners();
  
  // Setup AI suggestion tiles for empty fields
  setupAiSuggestTiles();
  
  // Populate raw JSON data
  const rawDataJson = document.getElementById('rawDataJson');
  if (rawDataJson) {
    // Create a clean copy without resumeText for display
    const displayProfile = { ...profile };
    delete displayProfile.resumeText;
    rawDataJson.textContent = JSON.stringify(displayProfile, null, 2);
  }
}

/**
 * Setup event listeners for skills management
 */
function setupSkillsEventListeners(): void {
  // Add skill button
  const addSkillBtn = document.getElementById('addSkillBtn');
  if (addSkillBtn) {
    addSkillBtn.addEventListener('click', () => {
      const skillsList = document.getElementById('skillsList');
      if (!skillsList) return;
      
      const index = skillsList.querySelectorAll('.editable-list-item').length;
      const div = document.createElement('div');
      div.className = 'editable-list-item';
      div.setAttribute('data-skill-index', String(index));
      div.innerHTML = `<input type="text" placeholder="Enter skill..." /><button type="button" class="remove-skill-btn">Remove</button>`;
      
      // Add event listener to the new remove button
      const removeBtn = div.querySelector('.remove-skill-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          div.remove();
        });
      }
      
      skillsList.appendChild(div);
    });
  }
  
  // Remove skill buttons (use event delegation for existing items)
  const skillsList = document.getElementById('skillsList');
  if (skillsList) {
    skillsList.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('remove-skill-btn')) {
        const item = target.closest('.editable-list-item');
        if (item) {
          item.remove();
        }
      }
    });
  }
}

/**
 * Setup click handlers for AI suggestion tiles on empty fields.
 * When clicked, sends a SUGGEST_FIELD message to the background script
 * which uses Ollama to infer the value from the resume text.
 */
function setupAiSuggestTiles(): void {
  const tiles = document.querySelectorAll<HTMLElement>('.ai-suggest-tile');
  if (tiles.length === 0) return;

  console.log(`[Onboarding] Setting up ${tiles.length} AI suggestion tiles`);

  tiles.forEach(tile => {
    tile.addEventListener('click', async () => {
      const fieldName = tile.getAttribute('data-field');
      if (!fieldName) return;

      // Prevent double-click
      if (tile.classList.contains('loading')) return;
      tile.classList.add('loading');
      tile.querySelector('.ai-label')!.textContent = 'Thinking...';

      try {
        // Get the resume text from the currently extracted profile
        const resumeText = extractedProfile?.resumeText || '';
        if (!resumeText) {
          showSuggestionError(tile, 'No resume text available. Upload a resume first.');
          return;
        }

        const response = await browser.runtime.sendMessage({
          kind: 'SUGGEST_FIELD',
          fieldName,
          resumeText,
        });

        if (response?.kind === 'SUGGEST_FIELD_RESULT' && response.value) {
          showSuggestionResult(tile, fieldName, response.value);
        } else {
          const errMsg = response?.error || 'Could not find this info in your resume.';
          showSuggestionError(tile, errMsg);
        }
      } catch (err) {
        console.error('[Onboarding] AI suggest failed:', err);
        showSuggestionError(tile, 'AI suggestion failed. Is Ollama running?');
      }
    });
  });

  // Also hide tiles when user starts typing in the input
  tiles.forEach(tile => {
    const wrapper = tile.closest('.input-wrapper');
    if (!wrapper) return;
    const input = wrapper.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
    if (!input) return;

    input.addEventListener('input', () => {
      if (input.value.trim()) {
        tile.style.display = 'none';
        // Also remove any suggestion result
        const result = wrapper.querySelector('.ai-suggestion-result');
        if (result) result.remove();
      } else {
        tile.style.display = '';
      }
    });
  });
}

/**
 * Show an AI suggestion result below the field, replacing the tile.
 */
function showSuggestionResult(tile: HTMLElement, fieldName: string, value: string): void {
  const wrapper = tile.closest('.input-wrapper');
  if (!wrapper) return;

  // Hide the tile
  tile.style.display = 'none';

  // Remove any existing result
  const existing = wrapper.querySelector('.ai-suggestion-result');
  if (existing) existing.remove();

  // Create suggestion result UI
  const result = document.createElement('div');
  result.className = 'ai-suggestion-result';
  result.innerHTML = `
    <span class="suggestion-text">${escapeHtml(value)}</span>
    <button type="button" class="accept-btn">Accept</button>
    <button type="button" class="dismiss-btn">Dismiss</button>
  `;

  // Accept: fill the input with the suggested value
  result.querySelector('.accept-btn')!.addEventListener('click', () => {
    const input = wrapper.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
    if (input) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    result.remove();
  });

  // Dismiss: remove the suggestion, re-show tile
  result.querySelector('.dismiss-btn')!.addEventListener('click', () => {
    result.remove();
    tile.style.display = '';
    tile.classList.remove('loading');
    tile.querySelector('.ai-label')!.textContent = 'Ask AI to suggest';
  });

  wrapper.appendChild(result);
}

/**
 * Show an error on the tile, then reset after a delay.
 */
function showSuggestionError(tile: HTMLElement, message: string): void {
  const label = tile.querySelector('.ai-label') as HTMLElement;
  tile.classList.remove('loading');
  label.textContent = message;
  label.style.color = '#c62828';

  setTimeout(() => {
    label.textContent = 'Ask AI to suggest';
    label.style.color = '';
  }, 3000);
}

/**
 * Collect self-ID data from form
 */
function collectSelfIdData(): any {
  const form = document.getElementById('selfIdForm') as HTMLFormElement;
  if (!form) return null;

  const formData = new FormData(form);
  
  // Collect multi-select checkboxes
  const gender: string[] = [];
  const race: string[] = [];
  const orientation: string[] = [];
  
  form.querySelectorAll('input[name="gender"]:checked').forEach((input: any) => {
    gender.push(input.value);
  });
  
  form.querySelectorAll('input[name="race"]:checked').forEach((input: any) => {
    race.push(input.value);
  });
  
  form.querySelectorAll('input[name="orientation"]:checked').forEach((input: any) => {
    orientation.push(input.value);
  });
  
  return {
    gender,
    race,
    orientation,
    veteran: formData.get('veteran') as string || '',
    transgender: formData.get('transgender') as string || '',
    disability: formData.get('disability') as string || '',
  };
}

/**
 * Collect work authorization data from form
 */
function collectWorkAuthData(): any {
  const form = document.getElementById('workAuthForm') as HTMLFormElement;
  if (!form) return null;

  const formData = new FormData(form);
  
  const legallyAuthorizedValue = formData.get('legallyAuthorized') as string;
  const requiresSponsorshipValue = formData.get('requiresSponsorship') as string;
  
  return {
    legallyAuthorized: legallyAuthorizedValue === 'yes',
    requiresSponsorship: requiresSponsorshipValue === 'yes',
    currentStatus: formData.get('currentStatus') as string || undefined,
    visaType: formData.get('visaType') as string || undefined,
    sponsorshipTimeline: formData.get('sponsorshipTimeline') as string || undefined,
  };
}

/**
 * Save profile with self-ID and move to work auth step
 */
async function saveSelfIdAndContinue(includeSelfId: boolean): Promise<void> {
  if (!extractedProfile) return;
  
  try {
    // Add self-ID data if requested
    if (includeSelfId) {
      const selfIdData = collectSelfIdData();
      if (selfIdData) {
        extractedProfile.selfId = selfIdData;
      }
    }
    
    // Move to work authorization step
    showStep('step-workauth');
  } catch (err) {
    alert('Failed to proceed: ' + (err instanceof Error ? err.message : 'Unknown error'));
  }
}

/**
 * Save final profile with all data
 */
async function saveFinalProfile(includeWorkAuth: boolean): Promise<void> {
  if (!extractedProfile) return;
  
  try {
    // Add work auth data if requested
    if (includeWorkAuth) {
      const workAuthData = collectWorkAuthData();
      if (workAuthData) {
        extractedProfile.workAuth = workAuthData;
      }
    }
    
    // Try to save the profile
    let profileSaved = false;
    try {
      await saveUserProfile(extractedProfile);
      profileSaved = true;
    } catch (saveErr) {
      console.error('[Onboarding] Initial save failed:', saveErr);
      
      // Storage might be full/corrupted - repair it first
      console.log('[Onboarding] Attempting storage repair before retry...');
      const repaired = await repairStorage();
      
      if (repaired) {
        try {
          await saveUserProfile(extractedProfile);
          profileSaved = true;
          console.log('[Onboarding] Profile saved after storage repair');
        } catch (retryErr) {
          console.error('[Onboarding] Save still failing after repair:', retryErr);
          
          // Last resort: strip resumeText (can be very large) and try again
          const lightProfile = { ...extractedProfile };
          lightProfile.resumeText = ''; // Remove the heavy data
          try {
            await saveUserProfile(lightProfile);
            profileSaved = true;
            console.log('[Onboarding] Profile saved (without resume text) after stripping heavy data');
          } catch (finalErr) {
            console.error('[Onboarding] Even light save failed:', finalErr);
          }
        }
      }
    }
    
    if (!profileSaved) {
      alert(
        'Failed to save profile. Your browser storage may be full or corrupted.\n\n' +
        'Try these steps:\n' +
        '1. Go to about:addons in Firefox\n' +
        '2. Find this extension and click "Remove"\n' +
        '3. Reinstall the extension\n' +
        '4. Upload your resume again'
      );
      return;
    }
    
    // Save resume file for auto-upload (using base64 for efficient storage)
    if (uploadedFile) {
      try {
        const arrayBuffer = await uploadedFile.arrayBuffer();
        
        // Convert to base64 instead of number array (3x more storage efficient)
        const uint8Array = new Uint8Array(arrayBuffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.subarray(i, i + chunkSize);
          binary += String.fromCharCode(...chunk);
        }
        const base64Data = btoa(binary);
        
        const resumeData = {
          name: uploadedFile.name,
          type: uploadedFile.type,
          size: uploadedFile.size,
          dataBase64: base64Data,
          data: null as number[] | null,
          lastUpdated: Date.now(),
        };
        
        // Save the full file data
        await browser.storage.local.set({ resumeFile: resumeData });
        
        // Also save metadata separately
        await browser.storage.local.set({
          resumeFileMeta: {
            name: uploadedFile.name,
            type: uploadedFile.type,
            size: uploadedFile.size,
            lastUpdated: Date.now(),
          }
        });
        
        console.log('Resume file saved for auto-upload:', uploadedFile.name, `(${uploadedFile.size} bytes, base64: ${base64Data.length} chars)`);
      } catch (err) {
        console.warn('Failed to save resume file binary:', err);
        // Profile was saved, just the file auto-upload won't work
        // This is OK - the user can still use the extension, they just need to manually attach resume
      }
    }
    
    showStep('step-success');
  } catch (err) {
    console.error('[Onboarding] saveFinalProfile error:', err);
    alert('Failed to save profile: ' + (err instanceof Error ? err.message : 'Unknown error'));
  }
}

/**
 * Collect edited profile data from form
 * Preserves work, education, selfId, and workAuth from existing profile
 */
function collectProfileFromForm(): UserProfile | null {
  const form = document.getElementById('profileForm') as HTMLFormElement;
  if (!form) return null;
  
  // Get form data
  const formData = new FormData(form);
  
  // Collect skills from skill inputs
  const skillsList = document.getElementById('skillsList');
  const skills: string[] = [];
  if (skillsList) {
    skillsList.querySelectorAll('.editable-list-item input').forEach((input: any) => {
      const value = input.value.trim();
      if (value) skills.push(value);
    });
  }
  
  const profile: UserProfile = {
    personal: {
      firstName: (formData.get('firstName') as string) || '',
      lastName: (formData.get('lastName') as string) || '',
      email: (formData.get('email') as string) || '',
      phone: (formData.get('phone') as string) || '',
      location: (formData.get('location') as string) || '',
    },
    professional: {
      linkedin: (formData.get('linkedin') as string) || '',
      github: (formData.get('github') as string) || '',
      portfolio: (formData.get('portfolio') as string) || '',
      yearsOfExperience: parseInt((formData.get('yearsOfExperience') as string) || '0', 10),
    },
    skills: skills,
    // IMPORTANT: Preserve work and education from extractedProfile (if editing existing profile)
    work: extractedProfile?.work || [],
    education: extractedProfile?.education || [],
    summary: (formData.get('summary') as string) || '',
    resumeText: extractedProfile?.resumeText || '',
    // IMPORTANT: Preserve selfId and workAuth from extractedProfile (if editing existing profile)
    selfId: extractedProfile?.selfId,
    workAuth: extractedProfile?.workAuth,
  };
  
  console.log('[Onboarding] Collected profile from form:', {
    hasWork: profile.work.length > 0,
    hasEducation: profile.education.length > 0,
    hasSelfId: !!profile.selfId,
    hasWorkAuth: !!profile.workAuth,
  });
  
  return profile;
}

/**
 * Create an empty profile template for manual entry
 */
function createEmptyProfile(): UserProfile {
  return {
    personal: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      location: ''
    },
    professional: {
      linkedin: '',
      github: '',
      portfolio: '',
      yearsOfExperience: 0
    },
    work: [],
    education: [],
    skills: [],
    summary: '',
    lastUpdated: Date.now()
  };
}

/**
 * Setup conditional field visibility for work authorization form
 */
function setupWorkAuthConditionalFields(): void {
  const legallyAuthorizedInputs = document.querySelectorAll('input[name="legallyAuthorized"]');
  const requiresSponsorshipInputs = document.querySelectorAll('input[name="requiresSponsorship"]');
  
  const currentStatusGroup = document.getElementById('currentStatusGroup');
  const visaTypeGroup = document.getElementById('visaTypeGroup');
  const sponsorshipTimelineGroup = document.getElementById('sponsorshipTimelineGroup');

  // Show/hide current status based on authorization
  legallyAuthorizedInputs.forEach((input: any) => {
    input.addEventListener('change', () => {
      if (input.checked && input.value === 'yes') {
        if (currentStatusGroup) currentStatusGroup.style.display = 'block';
      } else if (input.checked) {
        if (currentStatusGroup) currentStatusGroup.style.display = 'none';
      }
    });
  });

  // Show/hide visa fields based on sponsorship requirement
  requiresSponsorshipInputs.forEach((input: any) => {
    input.addEventListener('change', () => {
      if (input.checked && input.value === 'yes') {
        if (visaTypeGroup) visaTypeGroup.style.display = 'block';
        if (sponsorshipTimelineGroup) sponsorshipTimelineGroup.style.display = 'block';
      } else if (input.checked) {
        if (visaTypeGroup) visaTypeGroup.style.display = 'none';
        if (sponsorshipTimelineGroup) sponsorshipTimelineGroup.style.display = 'none';
      }
    });
  });
}

/**
 * Initialize onboarding
 */
/**
 * Pre-fill Self-ID form with existing data
 */
function preFillSelfIdForm(selfId: any): void {
  console.log('[Onboarding] Pre-filling Self-ID form with:', selfId);
  
  // Gender checkboxes
  if (selfId.gender && Array.isArray(selfId.gender)) {
    selfId.gender.forEach((genderValue: string) => {
      const checkbox = document.querySelector(`input[name="gender"][value="${genderValue}"]`) as HTMLInputElement;
      if (checkbox) {
        checkbox.checked = true;
      }
    });
  }
  
  // Race checkboxes
  if (selfId.race && Array.isArray(selfId.race)) {
    selfId.race.forEach((raceValue: string) => {
      const checkbox = document.querySelector(`input[name="race"][value="${raceValue}"]`) as HTMLInputElement;
      if (checkbox) {
        checkbox.checked = true;
      }
    });
  }
  
  // Orientation checkboxes
  if (selfId.orientation && Array.isArray(selfId.orientation)) {
    selfId.orientation.forEach((orientationValue: string) => {
      const checkbox = document.querySelector(`input[name="orientation"][value="${orientationValue}"]`) as HTMLInputElement;
      if (checkbox) {
        checkbox.checked = true;
      }
    });
  }
  
  // Veteran radio buttons
  if (selfId.veteran) {
    const veteranRadio = document.querySelector(`input[name="veteran"][value="${selfId.veteran}"]`) as HTMLInputElement;
    if (veteranRadio) {
      veteranRadio.checked = true;
    }
  }
  
  // Transgender radio buttons
  if (selfId.transgender) {
    const transgenderRadio = document.querySelector(`input[name="transgender"][value="${selfId.transgender}"]`) as HTMLInputElement;
    if (transgenderRadio) {
      transgenderRadio.checked = true;
    }
  }
  
  // Disability radio buttons
  if (selfId.disability) {
    const disabilityRadio = document.querySelector(`input[name="disability"][value="${selfId.disability}"]`) as HTMLInputElement;
    if (disabilityRadio) {
      disabilityRadio.checked = true;
    }
  }
}

/**
 * Setup mutually exclusive gender selection (only one can be selected)
 */
function setupMutuallyExclusiveGender(): void {
  const genderCheckboxes = document.querySelectorAll('input[name="gender"]');
  
  genderCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      
      if (target.checked) {
        // When one is checked, uncheck all others
        genderCheckboxes.forEach(other => {
          if (other !== target) {
            (other as HTMLInputElement).checked = false;
          }
        });
      }
    });
  });
  
  console.log('[Onboarding] Setup mutually exclusive gender selection');
}

/**
 * Pre-fill Work Authorization form with existing data
 */
function preFillWorkAuthForm(workAuth: any): void {
  console.log('[Onboarding] Pre-filling Work Auth form with:', workAuth);
  
  // Legally authorized radio (form uses "yes"/"no" strings)
  if (typeof workAuth.legallyAuthorized === 'boolean') {
    const radioValue = workAuth.legallyAuthorized ? 'yes' : 'no';
    const legalRadio = document.querySelector(`input[name="legallyAuthorized"][value="${radioValue}"]`) as HTMLInputElement;
    if (legalRadio) {
      legalRadio.checked = true;
      console.log('[Onboarding] Checked legally authorized:', radioValue);
    }
  }
  
  // Requires sponsorship radio (form uses "yes"/"no" strings)
  if (typeof workAuth.requiresSponsorship === 'boolean') {
    const radioValue = workAuth.requiresSponsorship ? 'yes' : 'no';
    const sponsorRadio = document.querySelector(`input[name="requiresSponsorship"][value="${radioValue}"]`) as HTMLInputElement;
    if (sponsorRadio) {
      sponsorRadio.checked = true;
      console.log('[Onboarding] Checked requires sponsorship:', radioValue);
    }
  }
  
  // Current status dropdown
  if (workAuth.currentStatus) {
    const statusSelect = document.querySelector('select[name="currentStatus"]') as HTMLSelectElement;
    if (statusSelect) {
      statusSelect.value = workAuth.currentStatus;
      console.log('[Onboarding] Set current status:', workAuth.currentStatus);
    }
  }
  
  // Visa type dropdown
  if (workAuth.visaType) {
    const visaSelect = document.querySelector('select[name="visaType"]') as HTMLSelectElement;
    if (visaSelect) {
      visaSelect.value = workAuth.visaType;
      console.log('[Onboarding] Set visa type:', workAuth.visaType);
    }
  }
  
  // Trigger conditional field visibility
  setupWorkAuthConditionalFields();
}

/**
 * Load and display learned values
 */
async function loadLearnedValues(showBackButton = false): Promise<void> {
  try {
    const result = await browser.storage.local.get('field_corrections');
    const corrections = result.field_corrections || [];
    
    const container = document.getElementById('learnedValuesContainer');
    if (!container) return;
    
    // Update button group to show/hide back button
    const buttonGroup = document.getElementById('learnedButtonGroup');
    if (buttonGroup) {
      if (showBackButton) {
        buttonGroup.innerHTML = `
          <button id="backFromLearnedBtn" class="btn btn-secondary">Back</button>
          <button id="doneFromLearnedBtn" class="btn btn-primary">Done</button>
        `;
        // Re-attach back button listener
        const backBtn = document.getElementById('backFromLearnedBtn');
        if (backBtn) {
          backBtn.addEventListener('click', () => {
            showStep('step-success');
          });
        }
        // Re-attach done button listener
        const doneBtn = document.getElementById('doneFromLearnedBtn');
        if (doneBtn) {
          doneBtn.addEventListener('click', () => {
            window.close();
          });
        }
      } else {
        buttonGroup.innerHTML = `
          <button id="doneFromLearnedBtn" class="btn btn-primary">Close</button>
        `;
        // Re-attach close button listener
        const doneBtn = document.getElementById('doneFromLearnedBtn');
        if (doneBtn) {
          doneBtn.addEventListener('click', () => {
            window.close();
          });
        }
      }
    }
    
    // Clear container
    container.innerHTML = '';
    
    if (corrections.length === 0) {
      container.innerHTML = `
        <div class="empty-learned-state">
          <h3>No learned values yet</h3>
          <p>The system will learn from your manual edits as you use the extension.</p>
        </div>
      `;
      return;
    }
    
    // Display each learned value
    corrections.forEach((correction: any, index: number) => {
      const card = document.createElement('div');
      card.className = 'learned-value-card';
      card.dataset.index = String(index);
      
      const date = new Date(correction.timestamp).toLocaleString();
      const company = correction.context?.company || 'Unknown';
      const jobTitle = correction.context?.jobTitle || 'Unknown position';
      
      card.innerHTML = `
        <div class="learned-value-info">
          <div class="learned-value-field">${correction.fieldLabel || correction.fieldType}</div>
          <div class="learned-value-change">
            <span class="learned-value-label">Auto-filled:</span>
            <span class="learned-value-text">${correction.autoFilledValue || '(empty)'}</span>
          </div>
          <div class="learned-value-change">
            <span class="learned-value-label">You changed to:</span>
            <span class="learned-value-text">${correction.userCorrectedValue}</span>
          </div>
          <div class="learned-value-meta">
            ${company} - ${jobTitle} • ${date}
          </div>
        </div>
        <div class="learned-value-actions">
          <button class="btn-delete" data-index="${index}">🗑️ Delete</button>
        </div>
      `;
      
      container.appendChild(card);
    });
    
    // Add delete listeners
    const deleteButtons = container.querySelectorAll('.btn-delete');
    deleteButtons.forEach(button => {
      button.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;
        const index = parseInt(target.dataset.index || '0', 10);
        await deleteLearnedValue(index);
      });
    });
    
    console.log('[Onboarding] Loaded', corrections.length, 'learned values');
  } catch (err) {
    console.error('[Onboarding] Failed to load learned values:', err);
  }
}

/**
 * Delete a learned value by index
 */
async function deleteLearnedValue(index: number): Promise<void> {
  try {
    const result = await browser.storage.local.get('field_corrections');
    const corrections = result.field_corrections || [];
    
    if (index < 0 || index >= corrections.length) {
      console.error('[Onboarding] Invalid index:', index);
      return;
    }
    
    // Remove the correction
    corrections.splice(index, 1);
    
    // Save back to storage
    await browser.storage.local.set({ field_corrections: corrections });
    
    console.log('[Onboarding] Deleted learned value. Remaining:', corrections.length);
    
    // Reload the display (preserve back button state)
    const hasBackButton = document.getElementById('backFromLearnedBtn') !== null;
    await loadLearnedValues(hasBackButton);
  } catch (err) {
    console.error('[Onboarding] Failed to delete learned value:', err);
    alert('Failed to delete learned value. Please try again.');
  }
}

/**
 * Attempt to repair corrupted/full storage.
 * When ALL storage operations fail, the only fix is to clear everything.
 * Returns true if storage is now working.
 */
async function repairStorage(): Promise<boolean> {
  console.log('[Onboarding] Attempting storage repair...');
  
  // Step 1: Try removing just the resume file (most likely cause of bloat)
  try {
    await browser.storage.local.remove('resumeFile');
    console.log('[Onboarding] Removed resumeFile key');
    // Test if storage works now
    await browser.storage.local.get('userProfile');
    console.log('[Onboarding] Storage is working after removing resumeFile');
    return true;
  } catch (_) {
    console.warn('[Onboarding] Remove resumeFile failed, trying harder...');
  }
  
  // Step 2: Try removing multiple large keys
  try {
    await browser.storage.local.remove(['resumeFile', 'resumeFileMeta', 'field_corrections']);
    await browser.storage.local.get('userProfile');
    console.log('[Onboarding] Storage working after removing large keys');
    return true;
  } catch (_) {
    console.warn('[Onboarding] Selective remove failed');
  }
  
  // Step 3: Nuclear option - clear everything
  try {
    await browser.storage.local.clear();
    console.log('[Onboarding] Cleared all storage');
    // Test
    await browser.storage.local.set({ _test: 1 });
    await browser.storage.local.remove('_test');
    console.log('[Onboarding] Storage is working after full clear');
    return true;
  } catch (clearErr) {
    console.error('[Onboarding] Even clear() failed - storage may be permanently broken:', clearErr);
    return false;
  }
}

/**
 * Migrate legacy resume file storage from number array to base64
 * Number array: 1MB PDF → ~4MB JSON storage
 * Base64: 1MB PDF → ~1.33MB JSON storage (3x improvement)
 */
async function migrateResumeFileStorage(): Promise<void> {
  try {
    const result = await browser.storage.local.get('resumeFile');
    const resumeFile = result.resumeFile;
    
    if (!resumeFile) return;
    
    // Already migrated (has base64 data)
    if (resumeFile.dataBase64 && resumeFile.dataBase64.length > 0) return;
    
    // Has legacy number array - migrate to base64
    if (resumeFile.data && Array.isArray(resumeFile.data) && resumeFile.data.length > 0) {
      console.log(`[Onboarding] Migrating resume file from number array (${resumeFile.data.length} bytes) to base64...`);
      
      try {
        const uint8Array = new Uint8Array(resumeFile.data);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.subarray(i, i + chunkSize);
          binary += String.fromCharCode(...chunk);
        }
        const base64Data = btoa(binary);
        
        // Save migrated data (remove the bloated number array)
        await browser.storage.local.set({
          resumeFile: {
            name: resumeFile.name,
            type: resumeFile.type,
            size: resumeFile.size,
            dataBase64: base64Data,
            data: null, // Clear the bloated array
            lastUpdated: resumeFile.lastUpdated || Date.now(),
          }
        });
        
        console.log(`[Onboarding] Resume file migrated to base64 (${base64Data.length} chars, was ${resumeFile.data.length} numbers)`);
      } catch (migErr) {
        console.warn('[Onboarding] Failed to migrate resume file, clearing it:', migErr);
        // If migration fails, just remove the resume file data to free storage
        try {
          await browser.storage.local.remove('resumeFile');
        } catch (_) { /* ignore */ }
      }
    }
  } catch (err) {
    console.warn('[Onboarding] Resume file migration check failed, attempting storage repair:', err);
    // Storage might be completely broken - try to repair it
    await repairStorage();
  }
}

async function init(): Promise<void> {
  // First, try to migrate any legacy bloated resume file storage
  await migrateResumeFileStorage();
  
  // Check if we should show learned values directly
  try {
    const flags = await browser.storage.local.get('showLearnedValues');
    if (flags.showLearnedValues) {
      console.log('[Onboarding] Showing learned values page...');
      await browser.storage.local.remove('showLearnedValues');
      await loadLearnedValues(false); // No back button when coming from popup
      showStep('step-learned');
      return;
    }
  } catch (err) {
    console.warn('[Onboarding] Failed to check learned values flag:', err);
    // Continue with normal initialization
  }
  
  // Check if we're editing an existing profile
  let existingProfile: UserProfile | undefined;
  try {
    const existingProfileData = await browser.storage.local.get('userProfile');
    existingProfile = existingProfileData.userProfile as UserProfile | undefined;
  } catch (err) {
    console.error('[Onboarding] Failed to load existing profile from storage:', err);
    // Storage is broken - repair it
    const repaired = await repairStorage();
    if (repaired) {
      try {
        const retryData = await browser.storage.local.get('userProfile');
        existingProfile = retryData.userProfile as UserProfile | undefined;
        console.log('[Onboarding] Profile loaded after storage repair:', !!existingProfile);
      } catch (retryErr) {
        console.error('[Onboarding] Still failing after repair, starting completely fresh:', retryErr);
        existingProfile = undefined;
      }
    } else {
      console.error('[Onboarding] Storage repair failed, starting fresh');
      existingProfile = undefined;
    }
  }
  
  if (existingProfile) {
    console.log('[Onboarding] Existing profile found, pre-filling form...');
    
    // Clean up empty education entries before displaying
    if (existingProfile.education) {
      existingProfile.education = existingProfile.education.filter(edu => 
        edu.school && edu.school.trim() !== '' || 
        edu.degree && edu.degree.trim() !== '' ||
        edu.field && edu.field.trim() !== ''
      );
    }
    
    // Skip directly to the review step with existing data
    extractedProfile = existingProfile;
    showStep('step-review');
    renderProfilePreview(existingProfile);
    
    // Update the title to indicate we're editing
    const titleEl = document.querySelector('h1');
    if (titleEl) {
      titleEl.textContent = 'Edit Your Profile';
    }
    
    // Add a "Start Fresh" button at the top
    const reviewStepDiv = document.getElementById('step-review');
    if (reviewStepDiv) {
      const existingButton = reviewStepDiv.querySelector('#startFreshBtn');
      if (!existingButton) {
        const startFreshBtn = document.createElement('button');
        startFreshBtn.id = 'startFreshBtn';
        startFreshBtn.className = 'btn btn-secondary';
        startFreshBtn.textContent = '🔄 Start Fresh (Upload New Resume)';
        startFreshBtn.style.cssText = 'margin-bottom: 16px; width: 100%;';
        startFreshBtn.onclick = () => {
          if (confirm('This will discard your current profile and start from scratch. Continue?')) {
            extractedProfile = null;
            showStep('step-upload');
            
            // Reset title
            const titleEl = document.querySelector('h1');
            if (titleEl) {
              titleEl.textContent = 'Setup Your Profile';
            }
          }
        };
        
        reviewStepDiv.insertBefore(startFreshBtn, reviewStepDiv.firstChild);
      }
    }
    
    // Show a notice
    showStatus('info', 'Editing existing profile. Make your changes and click Save.');
  }
  
  // Check connection status on load
  const connected = await checkConnection();
  updateConnectionStatus(connected);
  
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput') as HTMLInputElement;
  const parseBtn = document.getElementById('parseBtn') as HTMLButtonElement;
  const skipUploadBtn = document.getElementById('skipUploadBtn');
  const backBtn = document.getElementById('backBtn');
  const saveBtn = document.getElementById('saveBtn');
  const doneBtn = document.getElementById('doneBtn');
  
  // Upload area click
  if (uploadArea && fileInput) {
    uploadArea.addEventListener('click', () => {
      fileInput.click();
    });
    
    // File input change
    fileInput.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    });
    
    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragging');
    });
    
    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('dragging');
    });
    
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragging');
      
      const file = e.dataTransfer?.files[0];
      if (file) {
        handleFileSelect(file);
      }
    });
  }
  
  // Skip upload button - go directly to manual entry
  if (skipUploadBtn) {
    skipUploadBtn.addEventListener('click', () => {
      extractedProfile = createEmptyProfile();
      renderProfilePreview(extractedProfile);
      showStep('step-review');
    });
  }
  
  // Parse button
  if (parseBtn) {
    parseBtn.addEventListener('click', async () => {
      if (!uploadedFile) return;
      
      parseBtn.disabled = true;
      const originalText = parseBtn.textContent;
      parseBtn.innerHTML = '<span class="spinner"></span>Parsing...';
      hideStatus();
      
      try {
        // Stage 1: Reading file
        updateProgress('read', 10, 'Reading file...');
        
        // Stage 2: Extract text from file
        const resumeText = await extractTextFromFile(uploadedFile);
        updateProgress('extract', 50, 'Text extraction complete');
        
        // Stage 3: Parse with AI
        const profile = await parseResume(resumeText);
        profile.resumeText = resumeText;
        
        extractedProfile = profile;
        
        // Stage 4: Complete
        updateProgress('done', 100, 'All done!');
        await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause to show completion
        
        // Show review step
        hideProgress();
        renderProfilePreview(profile);
        showStep('step-review');
      } catch (err) {
        hideProgress();
        showStatus('error', err instanceof Error ? err.message : 'Failed to parse resume');
        parseBtn.disabled = false;
        parseBtn.textContent = originalText;
      }
    });
  }
  
  // Back button
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      showStep('step-upload');
    });
  }
  
  // Save button (review step) - go to self-ID
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      if (!extractedProfile) return;
      
      try {
        // Collect edited profile data from form
        const editedProfile = collectProfileFromForm();
        if (!editedProfile) {
          alert('Failed to collect profile data from form');
          return;
        }
        
        // Validate required fields
        if (!editedProfile.personal.firstName || !editedProfile.personal.lastName || !editedProfile.personal.email) {
          alert('Please fill in all required fields (First Name, Last Name, Email)');
          return;
        }
        
        // Store the profile temporarily (will save with self-ID data)
        extractedProfile = editedProfile;
        
        console.log('[Onboarding] Moving to self-ID step');
        
        // Move to self-ID step
        showStep('step-selfid');
        
        console.log('[Onboarding] Self-ID step should now be visible');
      } catch (err) {
        alert('Failed to proceed: ' + (err instanceof Error ? err.message : 'Unknown error'));
      }
    });
  }

  // Setup mutually exclusive gender selection (must be called after DOM is ready)
  setTimeout(() => {
    setupMutuallyExclusiveGender();
    
    if (existingProfile && existingProfile.selfId) {
      preFillSelfIdForm(existingProfile.selfId);
    }
    
    if (existingProfile && existingProfile.workAuth) {
      preFillWorkAuthForm(existingProfile.workAuth);
    }
  }, 100);
  
  // Back button from Self-ID step
  const backFromSelfIdBtn = document.getElementById('backFromSelfIdBtn');
  if (backFromSelfIdBtn) {
    backFromSelfIdBtn.addEventListener('click', () => {
      showStep('step-review');
    });
  }
  
  // Back button from Work Auth step
  const backFromWorkAuthBtn = document.getElementById('backFromWorkAuthBtn');
  if (backFromWorkAuthBtn) {
    backFromWorkAuthBtn.addEventListener('click', () => {
      showStep('step-selfid');
    });
  }
  
  // Self-ID buttons - move to work auth instead of saving
  const saveSelfIdBtn = document.getElementById('saveSelfIdBtn');
  const skipSelfIdBtn = document.getElementById('skipSelfIdBtn');
  
  console.log('[Onboarding] Self-ID buttons:', { saveSelfIdBtn: !!saveSelfIdBtn, skipSelfIdBtn: !!skipSelfIdBtn });
  
  if (saveSelfIdBtn) {
    saveSelfIdBtn.addEventListener('click', async () => {
      console.log('[Onboarding] Save Self-ID clicked');
      await saveSelfIdAndContinue(true);
    });
  } else {
    console.warn('[Onboarding] saveSelfIdBtn not found in DOM');
  }
  
  if (skipSelfIdBtn) {
    skipSelfIdBtn.addEventListener('click', async () => {
      console.log('[Onboarding] Skip Self-ID clicked');
      await saveSelfIdAndContinue(false);
    });
  } else {
    console.warn('[Onboarding] skipSelfIdBtn not found in DOM');
  }
  
  // Watch for when Self-ID step becomes visible to pre-fill it
  const observer = new MutationObserver(() => {
    const selfIdStep = document.getElementById('step-selfid');
    const workAuthStep = document.getElementById('step-workauth');
    
    if (selfIdStep?.classList.contains('active')) {
      // Setup mutually exclusive gender selection whenever Self-ID step is shown
      setupMutuallyExclusiveGender();
      
      if (existingProfile?.selfId) {
        preFillSelfIdForm(existingProfile.selfId);
      }
    }
    
    if (workAuthStep?.classList.contains('active') && existingProfile?.workAuth) {
      preFillWorkAuthForm(existingProfile.workAuth);
    }
  });
  
  const stepsContainer = document.querySelector('.content');
  if (stepsContainer) {
    observer.observe(stepsContainer, { 
      attributes: true, 
      attributeFilter: ['class'],
      subtree: true 
    });
  }

  // Work Authorization buttons
  const saveWorkAuthBtn = document.getElementById('saveWorkAuthBtn');
  const skipWorkAuthBtn = document.getElementById('skipWorkAuthBtn');
  
  if (saveWorkAuthBtn) {
    saveWorkAuthBtn.addEventListener('click', async () => {
      console.log('[Onboarding] Save Work Auth clicked');
      await saveFinalProfile(true);
    });
  }
  
  if (skipWorkAuthBtn) {
    skipWorkAuthBtn.addEventListener('click', async () => {
      console.log('[Onboarding] Skip Work Auth clicked');
      await saveFinalProfile(false);
    });
  }

  // Work Auth form conditional logic
  setupWorkAuthConditionalFields();
  
  // View Learned Values button (from success step)
  const viewLearnedBtn = document.getElementById('viewLearnedBtn');
  if (viewLearnedBtn) {
    viewLearnedBtn.addEventListener('click', async () => {
      await loadLearnedValues(true); // Show back button when coming from success page
      showStep('step-learned');
    });
  }
  
  // Done button
  if (doneBtn) {
    doneBtn.addEventListener('click', () => {
      window.close();
    });
  }
  
  // Raw data toggle
  const rawDataToggle = document.getElementById('rawDataToggle');
  const rawDataContent = document.getElementById('rawDataContent');
  if (rawDataToggle && rawDataContent) {
    rawDataToggle.addEventListener('click', () => {
      const isExpanded = rawDataContent.classList.contains('expanded');
      rawDataContent.classList.toggle('expanded');
      
      const toggleIcon = rawDataToggle.querySelector('.raw-data-toggle');
      if (toggleIcon) {
        toggleIcon.textContent = isExpanded ? '[+] Show' : '[-] Hide';
      }
    });
  }
}

init().catch(err => {
  console.error('[Onboarding] Initialization failed:', err);
  
  // If storage is corrupted, offer to clear and retry
  const message = err instanceof Error ? err.message : 'Unknown error';
  if (message.includes('unexpected') || message.includes('quota') || message.includes('corrupt')) {
    const shouldClear = confirm(
      'Failed to load profile data (storage may be full or corrupted). ' +
      'Would you like to clear storage and start fresh?'
    );
    if (shouldClear) {
      browser.storage.local.clear().then(() => {
        window.location.reload();
      }).catch(() => {
        alert('Failed to clear storage. Please try reinstalling the extension.');
      });
    }
  } else {
    // Show the upload step as fallback
    showStep('step-upload');
    showStatus('error', `Failed to initialize: ${message}. You can still upload a new resume.`);
  }
});
