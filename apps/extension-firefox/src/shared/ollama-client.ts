/**
 * Direct HTTP client for Ollama
 * No native messaging needed - just talk to Ollama's HTTP API directly
 */

import { getOllamaConfig } from './ollama-config';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
}

export class OllamaClient {
  private baseUrl = 'http://localhost:11434';
  private model = 'llama3.2';
  private embeddingModel = 'nomic-embed-text'; // Optimized for embeddings

  constructor(baseUrl?: string, model?: string) {
    if (baseUrl) this.baseUrl = baseUrl;
    if (model) this.model = model;
    // Load stored config asynchronously (won't block construction)
    this.loadStoredConfig();
  }

  private async loadStoredConfig(): Promise<void> {
    try {
      const config = await getOllamaConfig();
      if (config.enabled) {
        this.baseUrl = config.endpoint;
        this.model = config.chatModel;
        this.embeddingModel = config.embeddingModel;
        console.log('[Ollama] Loaded config from storage:', config.endpoint, config.chatModel);
      }
    } catch (err) {
      console.warn('[Ollama] Failed to load stored config, using defaults:', err);
    }
  }

  /**
   * Check if Ollama is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.baseUrl}/api/version`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get Ollama version info
   */
  async getVersion(): Promise<{ version: string } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/version`);
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Chat with Ollama using OpenAI-compatible API
   */
  async chat(messages: Message[], options?: {
    model?: string;
    temperature?: number;
    timeout?: number;
  }): Promise<string> {
    const model = options?.model || this.model;
    const temperature = options?.temperature ?? 0.1;
    const timeout = options?.timeout || 30000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      console.log('[Ollama] Sending chat request:', { model, messageCount: messages.length });

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          temperature,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data: ChatCompletionResponse = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('No response content from Ollama');
      }

      console.log('[Ollama] Chat response received:', content.substring(0, 100));
      return content;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('Ollama request timeout - is the model loaded?');
        }
        throw error;
      }
      throw new Error('Unknown error communicating with Ollama');
    }
  }

  /**
   * Create embeddings for text chunks
   */
  async createEmbedding(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.embeddingModel,
          prompt: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Embedding failed: ${response.status}`);
      }

      const data = await response.json();
      return data.embedding || [];
    } catch (error) {
      console.error('[Ollama] Embedding creation failed:', error);
      // Return empty embedding on failure
      return [];
    }
  }

  /**
   * Chunk text into smaller segments with overlap
   */
  private chunkText(text: string, maxChunkSize: number = 2000, overlap: number = 200): string[] {
    const chunks: string[] = [];
    const sentences = text.split(/[.!?]+\s+/);
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        
        // Add overlap by including last part of previous chunk
        const words = currentChunk.split(' ');
        const overlapWords = words.slice(-Math.floor(overlap / 5)); // ~5 chars per word
        currentChunk = overlapWords.join(' ') + ' ' + sentence;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Parse a specific section of the resume
   */
  private async parseSection(
    sectionText: string,
    sectionType: 'personal' | 'professional' | 'experience' | 'education' | 'skills'
  ): Promise<any> {
    const prompts = {
      personal: `Extract ONLY personal contact information from this text.
Name rules:
- firstName: given name only (e.g. "Joel")
- middleName: middle name if present, otherwise ""
- lastName: family/surname ONLY — never include middle names here (e.g. "Ponukumatla")
Return JSON in this exact format: {"firstName":"John","middleName":"","lastName":"Doe","email":"email@example.com","phone":"+1234567890","location":"City, State"}
If a field is missing, use an empty string "".`,
      
      professional: `Extract ONLY professional online profiles and links from this text.
Return JSON in this exact format: {"linkedin":"https://linkedin.com/in/username","github":"https://github.com/username","portfolio":"https://example.com","yearsOfExperience":5}
For LinkedIn, extract the full URL if present. For yearsOfExperience, calculate from dates if shown. Use 0 if not clear.`,
      
      experience: `Extract TOP-LEVEL job positions from this text.

Rules:
- Only include entries that represent an actual employed position at a real employer.
- Every entry MUST have a startDate. If no start date exists for an entry, skip it entirely.
- Do NOT extract sub-responsibilities, project names, initiative titles, or bullet points as separate job entries.
- Do NOT include education entries (degrees, courses) as work entries.
- Do NOT use the person's own name as a company name.
- description: combine ALL bullet points and achievements for that role into one string.

Return JSON array in this exact format:
[{"company":"Company Name","title":"Job Title","startDate":"Jan 2020","endDate":"Dec 2022","current":false,"description":"Complete list of duties: • Duty 1 • Duty 2"}]

If no valid dated work experience found, return empty array [].`,
      
      education: `Extract ALL education entries from this text.
Return JSON array in this exact format: [{"school":"University Name","degree":"Bachelor of Science","field":"Computer Science","graduationYear":"2020"}]
If no education found, return empty array [].`,
      
      skills: `Extract ALL technical skills, tools, technologies, programming languages, and competencies from this text.
Include: programming languages, frameworks, tools, soft skills, certifications.
Return JSON array: ["JavaScript","Python","React","Leadership","AWS Certified"]
If no skills found, return empty array [].`,
    };

    const systemPrompt = `You are an expert resume parser. Your task is to extract ${sectionType} information with high accuracy.
Be thorough and capture ALL details. Return ONLY valid JSON with no markdown formatting, no code blocks, no explanations.`;
    
    const userPrompt = `${prompts[sectionType]}\n\nResume text:\n${sectionText}\n\nReturn ONLY the JSON (no markdown, no explanations):`;

    const response = await this.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.1, timeout: 45000 }); // Longer timeout for detailed extraction

    // Extract JSON - handle various response formats
    let jsonStr = response.trim();
    
    // Remove markdown code blocks
    jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    
    // Remove any leading/trailing text before/after JSON
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (err) {
        console.error(`[Ollama] Failed to parse ${sectionType} JSON:`, err);
        return null;
      }
    }
    
    console.warn(`[Ollama] No valid JSON found for ${sectionType}`);
    return null;
  }

  /**
   * Parse resume text into structured profile with chunking
   */
  async parseResume(resumeText: string, onProgress?: (stage: string, percent: number) => void): Promise<any> {
    console.log('[Ollama] Starting chunked resume parsing...');
    console.log('[Ollama] Resume length:', resumeText.length);

    // Check if resume is small enough to parse in one go
    if (resumeText.length < 3000) {
      console.log('[Ollama] Resume is small, parsing in single pass');
      onProgress?.('Parsing resume...', 70);
      return await this.parseSinglePass(resumeText);
    }

    // For large resumes, use chunked approach
    console.log('[Ollama] Resume is large, using chunked parsing');
    
    // Split into chunks
    onProgress?.('Chunking resume...', 60);
    const chunks = this.chunkText(resumeText, 2000, 200);
    console.log(`[Ollama] Created ${chunks.length} chunks`);

    // Create embeddings for each chunk (for future retrieval)
    onProgress?.('Creating embeddings...', 65);
    const embeddings: Array<{ text: string; embedding: number[] }> = [];
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await this.createEmbedding(chunks[i]);
      embeddings.push({ text: chunks[i], embedding });
      console.log(`[Ollama] Created embedding for chunk ${i + 1}/${chunks.length}`);
    }

    // Store embeddings in browser storage for future use
    try {
      await browser.storage.local.set({
        'resume_embeddings': embeddings,
        'resume_chunks': chunks,
      });
      console.log('[Ollama] Stored embeddings in browser storage');
    } catch (err) {
      console.warn('[Ollama] Failed to store embeddings:', err);
    }

    // Parse different sections from relevant chunks
    const profile: any = {
      personal: {},
      professional: {},
      skills: [],
      work: [],
      education: [],
      summary: '',
    };

    // Stage 1: Extract personal info (usually in first chunk)
    onProgress?.('Extracting personal info...', 70);
    const personalInfo = await this.parseSection(chunks[0], 'personal');
    if (personalInfo) profile.personal = personalInfo;

    // Stage 2: Extract professional links (usually in first chunk)
    onProgress?.('Extracting professional links...', 75);
    const professionalInfo = await this.parseSection(chunks[0], 'professional');
    if (professionalInfo) profile.professional = professionalInfo;

    // Stage 3: Extract skills (could be anywhere)
    onProgress?.('Extracting skills...', 80);
    for (let i = 0; i < Math.min(chunks.length, 3); i++) {
      const skills = await this.parseSection(chunks[i], 'skills');
      if (skills && Array.isArray(skills)) {
        profile.skills = [...new Set([...profile.skills, ...skills])]; // Deduplicate
      }
    }

    // Stage 4: Extract work experience
    onProgress?.('Extracting work experience...', 85);
    for (const chunk of chunks) {
      if (chunk.toLowerCase().includes('experience') || chunk.toLowerCase().includes('work')) {
        const experience = await this.parseSection(chunk, 'experience');
        if (experience && Array.isArray(experience)) {
          profile.work = [...profile.work, ...experience];
        }
      }
    }
    // Filter phantom entries (no startDate) and deduplicate by company+title
    profile.work = profile.work.filter((j: any) => j.company && j.title && j.startDate && String(j.startDate).trim());
    const workSeen = new Set<string>();
    profile.work = profile.work.filter((j: any) => {
      const key = `${j.company}|${j.title}`.toLowerCase().trim();
      if (workSeen.has(key)) return false;
      workSeen.add(key);
      return true;
    });

    // Stage 5: Extract education
    onProgress?.('Extracting education...', 90);
    for (const chunk of chunks) {
      if (chunk.toLowerCase().includes('education') || chunk.toLowerCase().includes('university') || chunk.toLowerCase().includes('degree')) {
        const education = await this.parseSection(chunk, 'education');
        if (education && Array.isArray(education)) {
          profile.education = [...profile.education, ...education];
        }
      }
    }

    // Stage 6: Generate summary from first chunk
    onProgress?.('Generating summary...', 95);
    try {
      const summaryResponse = await this.chat([
        { role: 'system', content: 'Create a brief professional summary (2-3 sentences) from this resume text.' },
        { role: 'user', content: chunks[0] },
      ], { temperature: 0.3 });
      profile.summary = summaryResponse.trim();
    } catch {
      profile.summary = 'Professional with diverse experience and skills.';
    }

    console.log('[Ollama] Chunked parsing complete');
    return profile;
  }

  /**
   * Parse resume in single pass (for smaller resumes)
   */
  private async parseSinglePass(resumeText: string): Promise<any> {
    const systemPrompt = `You are an expert resume parser. Extract ALL information with high accuracy and detail.
For work experience, capture the COMPLETE employer name and ALL job duties/responsibilities.
Return ONLY valid JSON. Never include markdown, explanations, or any text outside the JSON object.`;

    const userPrompt = `Extract ALL information from this resume and return a JSON object with this exact structure:

{
  "personal": {
    "firstName": "Given name only (e.g. Joel)",
    "middleName": "Middle name if present, otherwise empty string",
    "lastName": "Family/surname ONLY — never include middle names here (e.g. Ponukumatla)",
    "email": "email@example.com",
    "phone": "+1234567890",
    "location": "City, State/Country"
  },
  "professional": {
    "linkedin": "Full LinkedIn URL (https://linkedin.com/in/username)",
    "github": "Full GitHub URL (https://github.com/username)",
    "portfolio": "Portfolio/website URL",
    "yearsOfExperience": total_years_as_number
  },
  "skills": ["skill1", "skill2", "tool1", "language1"],
  "work": [
    {
      "company": "Complete employer/company name",
      "title": "Complete job title",
      "startDate": "YYYY-MM (required — omit this entry entirely if no date)",
      "endDate": "YYYY-MM or null if current",
      "current": true_or_false,
      "description": "COMPLETE detailed description including ALL job duties, responsibilities, achievements, and bullet points from the resume"
    }
  ],
  "education": [
    {
      "school": "Full university/institution name",
      "degree": "Degree type (e.g., Bachelor of Science)",
      "field": "Field of study (e.g., Computer Science)",
      "graduationYear": "Year as string"
    }
  ],
  "summary": "Professional summary (2-3 sentences)"
}

IMPORTANT:
- firstName/lastName: put the family name ONLY in lastName; if a middle name exists, put it in middleName
- For work: only include TOP-LEVEL job positions with actual employment dates — do NOT extract sub-responsibilities, project names, or initiative titles as separate entries; do NOT use the person's own name as a company
- Every work entry MUST have startDate — omit the entry entirely if there is no start date
- For job descriptions, include ALL duties, achievements, and bullet points (not just a summary)
- For LinkedIn, extract the FULL URL if present
- Extract ALL skills mentioned (technical, soft skills, tools, languages)

Resume text:
${resumeText}

Return ONLY the JSON object, nothing else:`;

    const response = await this.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    console.log('[Ollama] Raw response:', response.substring(0, 500));

    // Try to extract JSON from response
    let jsonStr = response.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      console.error('[Ollama] No JSON found in response');
      throw new Error('Could not find JSON in response. Response: ' + jsonStr.substring(0, 200));
    }

    console.log('[Ollama] Extracted JSON string:', jsonMatch[0].substring(0, 300));

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('[Ollama] Successfully parsed JSON');
      return parsed;
    } catch (err) {
      console.error('[Ollama] JSON parse failed:', err);
      throw new Error('Invalid JSON in response: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  }
}

// Export singleton instance
export const ollama = new OllamaClient();
