/**
 * AI Agent Service with Ollama Integration via AI SDK
 * Browser-compatible implementation using ollama-ai-provider-v2
 */

import { generateText } from 'ai';
import { ollama } from 'ollama-ai-provider-v2';
import type { Message } from './types';

// Browser API shim for environments that don't have it
declare const browser: any;

/**
 * Robustly extract and parse JSON from a potentially malformed LLM response.
 */
function repairJSON(raw: string): unknown {
  const cleaned = raw.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const arrayMatch = cleaned.match(/(\[[\s\S]*\])/);
  if (arrayMatch) { try { return JSON.parse(arrayMatch[1]); } catch { /* fall through */ } }
  const objectMatch = cleaned.match(/(\{[\s\S]*\})/);
  if (objectMatch) { try { return JSON.parse(objectMatch[1]); } catch { /* fall through */ } }
  for (let i = cleaned.length - 1; i >= 0; i--) {
    if (cleaned[i] === ']' || cleaned[i] === '}') {
      try { return JSON.parse(cleaned.slice(0, i + 1)); } catch { /* continue */ }
    }
  }
  return [];
}

/**
 * AI-powered agent for form field analysis and resume parsing
 * Uses AI SDK with Ollama provider (browser-compatible)
 */
class MastraAgentService {
  private baseUrl: string;
  private model: string;
  private embeddingModel: string;
  private ollamaProvider: ReturnType<typeof ollama>;
  /** Set to false after the first embedding failure so callers can skip embedding-based retrieval */
  embeddingsAvailable = true;

  constructor(baseUrl = 'http://localhost:11434', model = 'llama3.2') {
    this.baseUrl = baseUrl;
    this.model = model;
    this.embeddingModel = 'nomic-embed-text';

    // Initialize Ollama provider with AI SDK (browser-compatible)
    this.ollamaProvider = ollama(this.model, {
      baseURL: this.baseUrl,
    });
  }

  /**
   * Check if Ollama is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/version`, {
        method: 'GET',
      });
      return response.ok;
    } catch (error) {
        console.error('[AIAgent] Connection check failed:', error);
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
   * Chat using AI SDK's generateText with Ollama
   */
  async chat(
    messages: Message[],
    options?: {
      model?: string;
      temperature?: number;
      timeout?: number;
      maxTokens?: number;
    }
  ): Promise<string> {
    try {
      console.log('[AIAgent] Sending chat request:', {
        model: options?.model || this.model,
        messageCount: messages.length,
      });

      // Convert messages to AI SDK format
      const systemMessage = messages.find((m) => m.role === 'system');
      const userMessages = messages.filter((m) => m.role !== 'system');

      // Combine all user/assistant messages into a prompt
      const prompt = userMessages.map((msg) => msg.content).join('\n\n');

      // Generate text using AI SDK — default 4096 to avoid truncating long JSON responses
      const result = await generateText({
        model: this.ollamaProvider,
        system: systemMessage?.content,
        prompt: prompt,
        temperature: options?.temperature ?? 0.1,
        maxTokens: options?.maxTokens ?? 4096,
      });

      const content = result.text;

      if (!content) {
        throw new Error('No response content from AI agent');
      }

      console.log('[AIAgent] Chat response received:', content.substring(0, 100));
      return content;
    } catch (error) {
      console.error('[AIAgent] Chat error:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Unknown error communicating with AI agent');
    }
  }

  /**
   * Create embeddings for text chunks using Ollama's embedding API.
   * Throws on failure so callers can detect unavailability and fall back to keyword retrieval.
   */
  async createEmbedding(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.embeddingModel, prompt: text }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API returned ${response.status} — is ${this.embeddingModel} pulled?`);
    }

    const data = await response.json();
    const vec = data.embedding as number[] | undefined;
    if (!vec || vec.length === 0) {
      throw new Error(`Empty embedding vector returned for model ${this.embeddingModel}`);
    }
    return vec;
  }

  /**
   * Chunk text into smaller segments with overlap
   */
  private chunkText(text: string, maxChunkSize = 2000, overlap = 200): string[] {
    const chunks: string[] = [];
    const sentences = text.split(/[.!?]+\s+/);
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());

        const words = currentChunk.split(' ');
        const overlapWords = words.slice(-Math.floor(overlap / 5));
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
   * Parse a specific section of the resume using Mastra agent
   */
  private async parseSection(
    sectionText: string,
    sectionType: 'personal' | 'professional' | 'experience' | 'education' | 'skills'
  ): Promise<any> {
    const prompts = {
      personal: `Extract ONLY personal contact information from this text.
Return JSON in this exact format: {"firstName":"John","lastName":"Doe","email":"email@example.com","phone":"+1234567890","location":"City, State"}
If a field is missing, use an empty string "".`,

      professional: `Extract ONLY professional online profiles and links from this text.
Return JSON in this exact format: {"linkedin":"https://linkedin.com/in/username","github":"https://github.com/username","portfolio":"https://example.com","yearsOfExperience":5}
For LinkedIn, extract the full URL if present. For yearsOfExperience, calculate from dates if shown. Use 0 if not clear.`,

      experience: `Extract ALL work experience entries from this text. For each job, extract:
- Company/Employer name (the organization name)
- Job title/position
- Start date (format: "Month Year" or "YYYY")
- End date (format: "Month Year" or "YYYY", or "Present" if current)
- Whether it's current position (true/false)
- Detailed description of job duties, responsibilities, and achievements (extract ALL bullet points and descriptions)

Return JSON array in this exact format:
[{"company":"Company Name","title":"Job Title","startDate":"Jan 2020","endDate":"Dec 2022","current":false,"description":"Complete list of duties: • Duty 1 • Duty 2 • Achievement 1"}]

If no work experience found, return empty array [].`,

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

    const response = await generateText({
      model: this.ollamaProvider,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.1,
      maxTokens: 3000,
    });

    // Extract JSON with repair fallback for malformed LLM output
    const repaired = repairJSON(response.text);
    if (repaired !== null && repaired !== undefined && !(Array.isArray(repaired) && (repaired as unknown[]).length === 0 && response.text.trim().length > 10)) {
      return repaired;
    }
    console.warn(`[AIAgent] No valid JSON found for ${sectionType}`);
    return null;
  }

  /**
   * Parse resume text into structured profile with chunking
   */
  async parseResume(
    resumeText: string,
    onProgress?: (stage: string, percent: number) => void
  ): Promise<any> {
      console.log('[AIAgent] Starting chunked resume parsing...');
      console.log('[AIAgent] Resume length:', resumeText.length);

    // Check if resume is small enough to parse in one go
    if (resumeText.length < 3000) {
        console.log('[AIAgent] Resume is small, parsing in single pass');
      onProgress?.('Parsing resume...', 70);
      return await this.parseSinglePass(resumeText);
    }

    // For large resumes, use chunked approach
      console.log('[AIAgent] Resume is large, using chunked parsing');

    // Split into chunks
    onProgress?.('Chunking resume...', 60);
    const chunks = this.chunkText(resumeText, 2000, 200);
      console.log(`[AIAgent] Created ${chunks.length} chunks`);

    // Create embeddings for each chunk
    onProgress?.('Creating embeddings...', 65);
    const embeddings: Array<{ text: string; embedding: number[] }> = [];
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await this.createEmbedding(chunks[i]);
      embeddings.push({ text: chunks[i], embedding });
        console.log(`[AIAgent] Created embedding for chunk ${i + 1}/${chunks.length}`);
    }

    // Store embeddings in browser storage
    try {
      await browser.storage.local.set({
        resume_embeddings: embeddings,
        resume_chunks: chunks,
      });
        console.log('[AIAgent] Stored embeddings in browser storage');
    } catch (err) {
        console.warn('[AIAgent] Failed to store embeddings:', err);
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

    // Extract personal info
    onProgress?.('Extracting personal info...', 70);
    const personalInfo = await this.parseSection(chunks[0], 'personal');
    if (personalInfo) profile.personal = personalInfo;

    // Extract professional links
    onProgress?.('Extracting professional links...', 75);
    const professionalInfo = await this.parseSection(chunks[0], 'professional');
    if (professionalInfo) profile.professional = professionalInfo;

    // Extract skills
    onProgress?.('Extracting skills...', 80);
    for (let i = 0; i < Math.min(chunks.length, 3); i++) {
      const skills = await this.parseSection(chunks[i], 'skills');
      if (skills && Array.isArray(skills)) {
        profile.skills = [...new Set([...profile.skills, ...skills])];
      }
    }

    // Extract work experience
    onProgress?.('Extracting work experience...', 85);
    for (const chunk of chunks) {
      if (chunk.toLowerCase().includes('experience') || chunk.toLowerCase().includes('work')) {
        const experience = await this.parseSection(chunk, 'experience');
        if (experience && Array.isArray(experience)) {
          profile.work = [...profile.work, ...experience];
        }
      }
    }
    // Deduplicate by normalized title (strip parentheticals) + company
    // Overlapping chunks produce variants like "Staff Architect" and "Staff Architect (Strategic Accounts)"
    // which share the same normalised title key and should collapse to one entry.
    const normalizeTitle = (t: string) =>
      String(t || '').replace(/\s*\(.*?\)\s*/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
    const seenWork = new Set<string>();
    profile.work = profile.work.filter((j: any) => {
      const titleKey = normalizeTitle(j.title);
      const company = String(j.company || '').toLowerCase().trim();
      const fullKey = company ? `${company}|${titleKey}` : titleKey;
      // Reject if we've already seen this normalised title regardless of company variation
      if (seenWork.has(titleKey) || seenWork.has(fullKey)) return false;
      seenWork.add(titleKey);
      seenWork.add(fullKey);
      return true;
    });
    // Cap at 8 entries — a single resume cannot have more real positions than this
    if (profile.work.length > 8) profile.work = profile.work.slice(0, 8);

    // Extract education
    onProgress?.('Extracting education...', 90);
    for (const chunk of chunks) {
      if (
        chunk.toLowerCase().includes('education') ||
        chunk.toLowerCase().includes('university') ||
        chunk.toLowerCase().includes('degree')
      ) {
        const education = await this.parseSection(chunk, 'education');
        if (education && Array.isArray(education)) {
          profile.education = [...profile.education, ...education];
        }
      }
    }
    // Deduplicate education by school+degree
    const seenEdu = new Set<string>();
    profile.education = profile.education.filter((e: any) => {
      const key = `${e.school}|${e.degree}`.toLowerCase().trim();
      if (seenEdu.has(key)) return false;
      seenEdu.add(key);
      return true;
    });

    // Generate summary
    onProgress?.('Generating summary...', 95);
    try {
      const summaryResult = await generateText({
        model: this.ollamaProvider,
        system: 'Create a brief professional summary (2-3 sentences) from this resume text.',
        prompt: chunks[0],
        temperature: 0.3,
        maxTokens: 200,
      });
      profile.summary = summaryResult.text.trim();
    } catch {
      profile.summary = 'Professional with diverse experience and skills.';
    }

      console.log('[AIAgent] Chunked parsing complete');
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
      "startDate": "Month Year or YYYY",
      "endDate": "Month Year or Present",
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
- For work experience, extract the COMPLETE employer name exactly as written
- For job descriptions, include ALL duties, achievements, and bullet points (not just a summary)
- For LinkedIn, extract the FULL URL if present
- Extract ALL skills mentioned (technical, soft skills, tools, languages)

Resume text:
${resumeText}

Return ONLY the JSON object, nothing else:`;

    const response = await generateText({
      model: this.ollamaProvider,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.1,
      maxTokens: 4000,
    });

    console.log('[AIAgent] Raw response:', response.text.substring(0, 500));

    // Extract JSON with repair fallback for malformed LLM output
    const repaired = repairJSON(response.text);
    if (repaired !== null && repaired !== undefined) {
      console.log('[AIAgent] Successfully parsed JSON');
      return repaired;
    }
    console.error('[AIAgent] JSON repair failed for response:', response.text.substring(0, 200));
    throw new Error('Could not parse JSON from response after repair attempt');
  }
}

// Export singleton instance
export const mastraAgent = new MastraAgentService();

// For backwards compatibility, also export as OllamaClient
export { MastraAgentService as OllamaClient };
