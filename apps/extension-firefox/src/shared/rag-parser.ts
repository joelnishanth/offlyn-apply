/**
 * RAG (Retrieval-Augmented Generation) Resume Parser
 * 
 * Uses semantic chunking + vector search for accurate extraction
 */

import { mastraAgent as ollama } from './mastra-agent';

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

export interface ResumeChunk {
  text: string;
  embedding: number[];
  metadata: {
    index: number;
    type: 'header' | 'content' | 'list' | 'mixed';
    keywords: string[];
  };
}

export interface RAGContext {
  chunks: ResumeChunk[];
  fullText: string;
}

export class RAGResumeParser {
  private context: RAGContext | null = null;

  /**
   * Semantic chunking - splits on section boundaries, not arbitrary lengths
   */
  private semanticChunk(text: string): Array<{ text: string; type: string }> {
    const chunks: Array<{ text: string; type: string }> = [];
    
    // Section headers (case-insensitive regex) — covers standard and non-standard resume headings
    const sectionPatterns = [
      /^(SUMMARY|PROFILE|ABOUT|OBJECTIVE|PROFESSIONAL SUMMARY|CAREER OBJECTIVE|CAREER SUMMARY)[\s:]/mi,
      /^(EXPERIENCE|EMPLOYMENT|WORK HISTORY|PROFESSIONAL EXPERIENCE|CAREER HISTORY|WORK EXPERIENCE|JOB HISTORY|PROFESSIONAL BACKGROUND|EMPLOYMENT HISTORY|RELEVANT EXPERIENCE)[\s:]/mi,
      /^(EDUCATION|ACADEMIC BACKGROUND|ACADEMIC HISTORY|EDUCATIONAL BACKGROUND|QUALIFICATIONS)[\s:]/mi,
      /^(SKILLS|TECHNICAL SKILLS|COMPETENCIES|EXPERTISE|KEY SKILLS|CORE COMPETENCIES|TECHNICAL EXPERTISE|CORE SKILLS|TECHNOLOGIES|TOOLS & TECHNOLOGIES|TECHNICAL PROFICIENCIES)[\s:]/mi,
      /^(PROJECTS|PORTFOLIO|PERSONAL PROJECTS|SIDE PROJECTS|KEY PROJECTS|NOTABLE PROJECTS)[\s:]/mi,
      /^(CERTIFICATIONS|CERTIFICATES|LICENSES|CREDENTIALS|PROFESSIONAL CERTIFICATIONS)[\s:]/mi,
      /^(AWARDS|ACHIEVEMENTS|HONORS|ACCOMPLISHMENTS|RECOGNITION)[\s:]/mi,
      /^(PUBLICATIONS|PAPERS|RESEARCH)[\s:]/mi,
      /^(VOLUNTEER|COMMUNITY|VOLUNTEERING|COMMUNITY INVOLVEMENT)[\s:]/mi,
      /^(LANGUAGES|LANGUAGE SKILLS)[\s:]/mi,
      /^(INTERESTS|HOBBIES|ACTIVITIES|EXTRACURRICULAR)[\s:]/mi,
    ];

    // Split by double newlines or section headers
    const lines = text.split('\n');
    let currentChunk = '';
    let currentType = 'content';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check if this line is a section header
      let isHeader = false;
      for (const pattern of sectionPatterns) {
        if (pattern.test(line)) {
          isHeader = true;
          
          // Save previous chunk if exists
          if (currentChunk.trim()) {
            chunks.push({ text: currentChunk.trim(), type: currentType });
          }
          
          // Start new chunk with header
          currentChunk = line + '\n';
          currentType = 'header';
          break;
        }
      }

      if (!isHeader) {
        // Add to current chunk
        currentChunk += line + '\n';
        
        // If chunk is getting large (>800 chars), split it
        if (currentChunk.length > 800 && (line === '' || line.match(/^[•\-\*]/))) {
          chunks.push({ text: currentChunk.trim(), type: currentType });
          currentChunk = '';
          currentType = 'content';
        }
      }
    }

    // Add final chunk
    if (currentChunk.trim()) {
      chunks.push({ text: currentChunk.trim(), type: currentType });
    }

    return chunks;
  }

  /**
   * Extract keywords from chunk for metadata
   */
  private extractKeywords(text: string): string[] {
    const keywords: string[] = [];
    
    // Common resume keywords
    const patterns = {
      experience: /\b(experience|work|employment|job|position|role)\b/i,
      education: /\b(education|degree|university|college|bachelor|master|phd)\b/i,
      skills: /\b(skills|technologies|tools|languages|frameworks)\b/i,
      projects: /\b(project|built|developed|created|designed)\b/i,
      leadership: /\b(led|managed|supervised|coordinated|team)\b/i,
      achievement: /\b(achieved|improved|increased|reduced|saved)\b/i,
    };

    for (const [key, pattern] of Object.entries(patterns)) {
      if (pattern.test(text)) {
        keywords.push(key);
      }
    }

    return keywords;
  }

  /**
   * Initialize RAG context with embeddings
   */
  async initializeContext(resumeText: string, onProgress?: (stage: string, percent: number, detail?: string) => void): Promise<void> {
    console.log('[RAG] Initializing RAG context...');
    onProgress?.('Creating semantic chunks...', 60, 'Splitting resume into logical sections');

    // Semantic chunking
    const semanticChunks = this.semanticChunk(resumeText);
    console.log(`[RAG] Created ${semanticChunks.length} semantic chunks`);
    onProgress?.(`Found ${semanticChunks.length} sections`, 62, semanticChunks.slice(0, 3).map(c => c.text.split('\n')[0]).join(' | '));

    // Create embeddings for each chunk
    onProgress?.('Generating embeddings...', 65, 'Converting text to vector representations');
    const chunks: ResumeChunk[] = [];

    for (let i = 0; i < semanticChunks.length; i++) {
      const chunk = semanticChunks[i];
      const preview = chunk.text.substring(0, 80).replace(/\n/g, ' ').trim();
      const keywords = this.extractKeywords(chunk.text);

      let embedding: number[] = [];
      if (ollama.embeddingsAvailable) {
        try {
          embedding = await ollama.createEmbedding(chunk.text);
        } catch (err) {
          console.warn(`[RAG] Embedding failed for chunk ${i} — disabling embedding retrieval:`, err);
          ollama.embeddingsAvailable = false;
        }
      }

      chunks.push({
        text: chunk.text,
        embedding,
        metadata: { index: i, type: chunk.type as any, keywords },
      });

      const pct = 65 + ((i + 1) / semanticChunks.length) * 10;
      onProgress?.(`Indexing ${i + 1}/${semanticChunks.length}`, pct, preview);
    }

    this.context = {
      chunks,
      fullText: resumeText,
    };

    // Store in browser storage for future use
    try {
      await browser.storage.local.set({
        'rag_context': {
          chunks: chunks.map(c => ({
            text: c.text,
            embedding: c.embedding,
            metadata: c.metadata,
          })),
          fullText: resumeText,
          timestamp: Date.now(),
        },
      });
      console.log('[RAG] Stored RAG context in browser storage');
    } catch (err) {
      console.warn('[RAG] Failed to store RAG context:', err);
    }

    onProgress?.('RAG context ready', 75, `${chunks.length} chunks indexed and ready`);
  }

  /**
   * Cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Keyword-based chunk scoring fallback used when embeddings are unavailable.
   * Scores each chunk by how many query words it contains.
   */
  private keywordScore(chunk: ResumeChunk, queryWords: string[]): number {
    const text = chunk.text.toLowerCase();
    return queryWords.reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0);
  }

  /**
   * Retrieve relevant chunks for a query.
   * Tries embedding-based cosine similarity first; falls back to keyword scoring
   * if the embedding model is unavailable (e.g. nomic-embed-text not pulled).
   */
  async retrieveRelevantChunks(query: string, topK: number = 5): Promise<ResumeChunk[]> {
    if (!this.context) {
      throw new Error('RAG context not initialized. Call initializeContext first.');
    }

    console.log(`[RAG] Retrieving chunks for query: "${query}"`);

    if (ollama.embeddingsAvailable) {
      try {
        const queryEmbedding = await ollama.createEmbedding(query);

        const scored = this.context.chunks.map(chunk => ({
          chunk,
          score: this.cosineSimilarity(queryEmbedding, chunk.embedding),
        }));

        scored.sort((a, b) => b.score - a.score);
        const topChunks = scored.slice(0, topK).map(s => s.chunk);
        console.log(`[RAG] Embedding retrieval: top scores ${scored.slice(0, topK).map(s => s.score.toFixed(3)).join(', ')}`);
        return topChunks;
      } catch (err) {
        console.warn('[RAG] Embedding retrieval failed, switching to keyword fallback:', err);
        ollama.embeddingsAvailable = false;
      }
    }

    // Keyword fallback — score by query word overlap
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const scored = this.context.chunks.map(chunk => ({
      chunk,
      score: this.keywordScore(chunk, queryWords),
    }));
    scored.sort((a, b) => b.score - a.score);
    console.log(`[RAG] Keyword fallback retrieval for: "${query}"`);
    return scored.slice(0, topK).map(s => s.chunk);
  }

  /**
   * Extract information using RAG
   */
  async extractWithRAG(
    query: string,
    extractionPrompt: string,
    topK: number = 5
  ): Promise<any> {
    // Retrieve relevant chunks
    const relevantChunks = await this.retrieveRelevantChunks(query, topK);

    // Combine chunks into context
    const context = relevantChunks.map((c, i) => `[Chunk ${i + 1}]\n${c.text}`).join('\n\n---\n\n');

    console.log(`[RAG] Using ${relevantChunks.length} chunks (${context.length} chars) for extraction`);

    // Generate with LLM
    const systemPrompt = `You are an expert resume parser. Extract information accurately from the provided resume chunks.
Return ONLY valid JSON with no markdown formatting, no code blocks, no explanations.`;

    const userPrompt = `${extractionPrompt}

Resume context:
${context}

Return ONLY the JSON (no markdown, no explanations):`;

    const response = await ollama.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { temperature: 0.1, timeout: 30000, maxTokens: 4096 });

    // Parse JSON with repair fallback for malformed LLM output
    const repaired = repairJSON(response);
    if (repaired !== null && repaired !== undefined) {
      return repaired;
    }
    console.warn('[RAG] JSON repair failed for response:', response.substring(0, 200));
    return null;
  }

  /**
   * Parse entire resume using RAG
   */
  async parseResume(resumeText: string, onProgress?: (stage: string, percent: number, detail?: string) => void): Promise<any> {
    console.log('[RAG] Starting RAG-based resume parsing...');

    // Initialize context
    await this.initializeContext(resumeText, onProgress);

    const profile: any = {
      personal: {},
      professional: {},
      skills: [],
      work: [],
      education: [],
      certifications: [],
      projects: [],
      summary: '',
    };

    // Contact info is almost always in the first ~400 chars of a resume — always include it
    // regardless of what chunk retrieval returns so it's never missed.
    const resumeHeader = resumeText.substring(0, 400);

    // 1. Extract personal information
    onProgress?.('Extracting personal info...', 76, 'Searching for name, email, phone, location');
    const personalQuery = 'contact information name email phone location address linkedin github';
    const personalData = await this.extractWithRAG(
      personalQuery,
      `Extract personal/contact information from the resume.
Rules for names:
- firstName: given name only (e.g. "Joel")
- middleName: middle name if present, otherwise ""  (e.g. "Nishanth")
- lastName: family/surname only — never include middle names here (e.g. "Ponukumatla")
- If the person has only two names (no middle), put them in firstName and lastName only.

IMPORTANT: The resume header (first lines) usually contains name/email/phone. Prioritise it.

Resume header (guaranteed):
${resumeHeader}

Return JSON: {"firstName":"","middleName":"","lastName":"","email":"","phone":"","location":""}`,
      5
    );
    if (personalData) {
      profile.personal = personalData;
      const found = Object.entries(personalData).filter(([, v]) => v).map(([k]) => k);
      onProgress?.('Personal info extracted', 78, found.length ? `Found: ${found.join(', ')}` : 'Parsing contact details...');
    }

    // 2. Extract professional links
    onProgress?.('Extracting professional links...', 79, 'Scanning for LinkedIn, GitHub, portfolio URLs');
    const professionalQuery = 'linkedin github portfolio website profile links social media url';
    const professionalData = await this.extractWithRAG(
      professionalQuery,
      `Extract professional links and years of experience.

IMPORTANT: The resume header often contains URLs. Check it first.

Resume header (guaranteed):
${resumeHeader}

Return JSON: {"linkedin":"","github":"","portfolio":"","yearsOfExperience":0}`,
      4
    );
    if (professionalData) {
      profile.professional = professionalData;
      const links = [professionalData.linkedin && 'LinkedIn', professionalData.github && 'GitHub', professionalData.portfolio && 'Portfolio'].filter(Boolean);
      onProgress?.('Links extracted', 80, links.length ? `Found: ${links.join(', ')}` : 'No links detected');
    }

    // 3. Extract skills
    onProgress?.('Extracting skills...', 81, 'Identifying technologies, tools, and competencies');
    const skillsQuery = 'skills technologies tools programming languages frameworks competencies expertise core skills key skills technical proficiencies';
    const skillsData = await this.extractWithRAG(
      skillsQuery,
      `Extract ALL technical skills, tools, technologies, programming languages, and competencies.
Include soft skills and domain knowledge if present.
Return JSON array: ["skill1","skill2","tool1","language1"]`,
      7
    );
    if (skillsData && Array.isArray(skillsData)) {
      profile.skills = skillsData;
      const preview = skillsData.slice(0, 6).join(', ');
      onProgress?.(`Found ${skillsData.length} skills`, 83, preview + (skillsData.length > 6 ? '...' : ''));
    }

    // 4. Extract work experience
    onProgress?.('Extracting work experience...', 84, 'Analyzing employment history, roles, and achievements');
    const workQuery = 'work experience employment job history positions roles career history professional background responsibilities achievements company employer';
    const workData = await this.extractWithRAG(
      workQuery,
      `Extract TOP-LEVEL job positions from the resume work experience section.

Rules:
- Only include entries that represent an actual employed position with a real employer.
- Every entry MUST have a startDate. Acceptable formats: "YYYY-MM", "Month YYYY", "YYYY". If no date at all, skip that entry.
- Do NOT extract sub-responsibilities, project names, initiative names, or bullet points as separate job entries.
- Do NOT include education entries (degrees, courses) as work entries.
- Do NOT include the person's own name as a company name.
- Deduplicate: if the same company+title appears more than once, include it only once.
- description: combine ALL bullet points and achievements for that role into one string.

Return JSON array: [{"company":"","title":"","startDate":"YYYY-MM or Month YYYY","endDate":"YYYY-MM or null","current":false,"description":""}]
If no valid dated work experience found, return [].`,
      9
    );
    if (workData && Array.isArray(workData)) {
      // Require at least a title and a startDate — company may be blank if the model missed it
      const validWork = workData.filter((j: any) =>
        j.title && String(j.title).trim() && j.startDate && String(j.startDate).trim()
      );
      const seen = new Set<string>();
      profile.work = validWork.filter((j: any) => {
        // Deduplicate: normalize title (strip parentheticals) so variations collapse
        const normTitle = String(j.title || '').replace(/\s*\(.*?\)\s*/g, '').toLowerCase().trim();
        const company = String(j.company || '').toLowerCase().trim();
        const key = company ? `${company}|${normTitle}` : normTitle;
        if (seen.has(normTitle) || seen.has(key)) return false;
        seen.add(normTitle);
        seen.add(key);
        return true;
      });
      const jobs = profile.work.map((j: any) => `${j.title} @ ${j.company}`).slice(0, 3);
      onProgress?.(`Found ${profile.work.length} positions`, 87, jobs.join(' | '));
    }

    // 5. Extract education
    onProgress?.('Extracting education...', 88, 'Looking for degrees, schools, and graduation dates');
    const educationQuery = 'education academic background degrees university college school graduation bachelor master phd diploma';
    const educationData = await this.extractWithRAG(
      educationQuery,
      `Extract ALL education entries.
Return JSON array: [{"school":"","degree":"","field":"","graduationYear":""}]`,
      5
    );
    if (educationData && Array.isArray(educationData)) {
      profile.education = educationData;
      const edu = educationData.map((e: any) => `${e.degree} - ${e.school}`).slice(0, 2);
      onProgress?.(`Found ${educationData.length} entries`, 90, edu.join(' | '));
    }

    // 6. Extract certifications
    onProgress?.('Extracting certifications...', 91, 'Scanning for certificates and licenses');
    const certificationsQuery = 'certifications certificates licenses credentials professional certifications';
    const certificationsData = await this.extractWithRAG(
      certificationsQuery,
      `Extract certifications and licenses.
Return JSON array of strings: ["AWS Certified Developer","PMP","Security+"]`,
      3
    );
    if (certificationsData && Array.isArray(certificationsData)) {
      profile.certifications = certificationsData;
      onProgress?.(`Found ${certificationsData.length} certifications`, 93, certificationsData.slice(0, 4).join(', '));
    }

    // 7. Extract projects
    onProgress?.('Extracting projects...', 94, 'Finding project highlights and contributions');
    const projectsQuery = 'projects portfolio work side projects open source contributions';
    const projectsData = await this.extractWithRAG(
      projectsQuery,
      `Extract notable projects.
Return JSON array: [{"name":"","description":"","technologies":[]}]`,
      5
    );
    if (projectsData && Array.isArray(projectsData)) {
      profile.projects = projectsData;
      const names = projectsData.map((p: any) => p.name).filter(Boolean).slice(0, 3);
      onProgress?.(`Found ${projectsData.length} projects`, 96, names.join(', '));
    }

    // 8. Generate summary using most relevant chunks
    onProgress?.('Generating summary...', 97, 'Composing a professional overview');
    const summaryQuery = 'professional summary profile overview career objective background';
    const summaryChunks = await this.retrieveRelevantChunks(summaryQuery, 3);
    const summaryContext = summaryChunks.map(c => c.text).join('\n');
    
    try {
      const summaryResponse = await ollama.chat([
        { role: 'system', content: 'Create a concise professional summary (2-3 sentences) highlighting key qualifications and experience.' },
        { role: 'user', content: `Resume excerpt:\n${summaryContext}` },
      ], { temperature: 0.3 });
      profile.summary = summaryResponse.trim();
      onProgress?.('Summary generated', 99, profile.summary.substring(0, 100) + '...');
    } catch {
      profile.summary = 'Experienced professional with diverse skills and achievements.';
    }

    onProgress?.('RAG parsing complete', 100, 'All sections extracted successfully');
    console.log('[RAG] Parsing complete');
    console.log('[RAG] Extracted:', {
      personalFields: Object.keys(profile.personal).length,
      skills: profile.skills.length,
      workEntries: profile.work.length,
      educationEntries: profile.education.length,
      certifications: profile.certifications.length,
      projects: profile.projects.length,
    });

    return profile;
  }

  /**
   * Query the resume with natural language
   */
  async query(question: string, topK: number = 5): Promise<string> {
    if (!this.context) {
      throw new Error('RAG context not initialized');
    }

    console.log(`[RAG] Processing query: "${question}"`);

    // Retrieve relevant chunks
    const relevantChunks = await this.retrieveRelevantChunks(question, topK);
    const context = relevantChunks.map((c, i) => `[Section ${i + 1}]\n${c.text}`).join('\n\n');

    // Answer question using context
    const response = await ollama.chat([
      { role: 'system', content: 'You are a helpful assistant. Answer questions based only on the provided resume context.' },
      { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}\n\nAnswer:` },
    ], { temperature: 0.2 });

    return response.trim();
  }

  /**
   * Load cached RAG context from storage
   */
  async loadCachedContext(): Promise<boolean> {
    try {
      const stored = await browser.storage.local.get('rag_context');
      
      if (stored.rag_context) {
        this.context = {
          chunks: stored.rag_context.chunks.map((c: any) => ({
            text: c.text,
            embedding: c.embedding,
            metadata: c.metadata,
          })),
          fullText: stored.rag_context.fullText,
        };
        
        console.log(`[RAG] Loaded cached context with ${this.context.chunks.length} chunks`);
        return true;
      }
    } catch (err) {
      console.warn('[RAG] Failed to load cached context:', err);
    }
    
    return false;
  }
}

// Singleton instance
export const ragParser = new RAGResumeParser();
