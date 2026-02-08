/**
 * RAG (Retrieval-Augmented Generation) Resume Parser
 * 
 * Uses semantic chunking + vector search for accurate extraction
 */

import { mastraAgent as ollama } from './mastra-agent';

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
    
    // Section headers (case-insensitive regex)
    const sectionPatterns = [
      /^(SUMMARY|PROFILE|ABOUT|OBJECTIVE)[\s:]/mi,
      /^(EXPERIENCE|EMPLOYMENT|WORK HISTORY|PROFESSIONAL EXPERIENCE)[\s:]/mi,
      /^(EDUCATION|ACADEMIC BACKGROUND)[\s:]/mi,
      /^(SKILLS|TECHNICAL SKILLS|COMPETENCIES|EXPERTISE)[\s:]/mi,
      /^(PROJECTS|PORTFOLIO)[\s:]/mi,
      /^(CERTIFICATIONS|CERTIFICATES|LICENSES)[\s:]/mi,
      /^(AWARDS|ACHIEVEMENTS|HONORS)[\s:]/mi,
      /^(PUBLICATIONS|PAPERS)[\s:]/mi,
      /^(VOLUNTEER|COMMUNITY)[\s:]/mi,
      /^(LANGUAGES)[\s:]/mi,
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
  async initializeContext(resumeText: string, onProgress?: (stage: string, percent: number) => void): Promise<void> {
    console.log('[RAG] Initializing RAG context...');
    onProgress?.('Creating semantic chunks...', 60);

    // Semantic chunking
    const semanticChunks = this.semanticChunk(resumeText);
    console.log(`[RAG] Created ${semanticChunks.length} semantic chunks`);

    // Create embeddings for each chunk
    onProgress?.('Generating embeddings...', 65);
    const chunks: ResumeChunk[] = [];

    for (let i = 0; i < semanticChunks.length; i++) {
      const chunk = semanticChunks[i];
      
      try {
        const embedding = await ollama.createEmbedding(chunk.text);
        const keywords = this.extractKeywords(chunk.text);

        chunks.push({
          text: chunk.text,
          embedding,
          metadata: {
            index: i,
            type: chunk.type as any,
            keywords,
          },
        });

        if ((i + 1) % 5 === 0) {
          onProgress?.(`Embeddings: ${i + 1}/${semanticChunks.length}`, 65 + (i / semanticChunks.length) * 10);
        }
      } catch (err) {
        console.warn(`[RAG] Failed to create embedding for chunk ${i}:`, err);
      }
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

    onProgress?.('RAG context ready', 75);
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
   * Retrieve relevant chunks for a query
   */
  async retrieveRelevantChunks(query: string, topK: number = 5): Promise<ResumeChunk[]> {
    if (!this.context) {
      throw new Error('RAG context not initialized. Call initializeContext first.');
    }

    console.log(`[RAG] Retrieving chunks for query: "${query}"`);

    // Create embedding for query
    const queryEmbedding = await ollama.createEmbedding(query);

    // Calculate similarity scores
    const scored = this.context.chunks.map(chunk => ({
      chunk,
      score: this.cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    // Sort by score and return top K
    scored.sort((a, b) => b.score - a.score);
    const topChunks = scored.slice(0, topK).map(s => s.chunk);

    console.log(`[RAG] Retrieved ${topChunks.length} relevant chunks`);
    console.log('[RAG] Top scores:', scored.slice(0, topK).map(s => s.score.toFixed(3)).join(', '));

    return topChunks;
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
    ], { temperature: 0.1, timeout: 30000 });

    // Parse JSON
    let jsonStr = response.trim();
    jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}|\[[\s\S]*\]/);

    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (err) {
        console.error('[RAG] Failed to parse JSON:', err);
        return null;
      }
    }

    return null;
  }

  /**
   * Parse entire resume using RAG
   */
  async parseResume(resumeText: string, onProgress?: (stage: string, percent: number) => void): Promise<any> {
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

    // 1. Extract personal information
    onProgress?.('Extracting personal info...', 76);
    const personalQuery = 'contact information name email phone location address';
    const personalData = await this.extractWithRAG(
      personalQuery,
      `Extract personal/contact information from the resume.
Return JSON: {"firstName":"","lastName":"","email":"","phone":"","location":""}`,
      3
    );
    if (personalData) profile.personal = personalData;

    // 2. Extract professional links
    onProgress?.('Extracting professional links...', 78);
    const professionalQuery = 'linkedin github portfolio website profile links social media';
    const professionalData = await this.extractWithRAG(
      professionalQuery,
      `Extract professional links and years of experience.
Return JSON: {"linkedin":"","github":"","portfolio":"","yearsOfExperience":0}`,
      3
    );
    if (professionalData) profile.professional = professionalData;

    // 3. Extract skills
    onProgress?.('Extracting skills...', 80);
    const skillsQuery = 'skills technologies tools programming languages frameworks competencies expertise';
    const skillsData = await this.extractWithRAG(
      skillsQuery,
      `Extract ALL technical skills, tools, technologies, programming languages, and competencies.
Return JSON array: ["skill1","skill2","tool1","language1"]`,
      5
    );
    if (skillsData && Array.isArray(skillsData)) {
      profile.skills = skillsData;
    }

    // 4. Extract work experience
    onProgress?.('Extracting work experience...', 83);
    const workQuery = 'work experience employment job history positions roles responsibilities duties achievements';
    const workData = await this.extractWithRAG(
      workQuery,
      `Extract ALL work experience entries with complete details.
For each job, include: company name, job title, start date, end date, whether it's current, and DETAILED description of all duties and achievements.
Return JSON array: [{"company":"","title":"","startDate":"","endDate":"","current":false,"description":""}]`,
      7
    );
    if (workData && Array.isArray(workData)) {
      profile.work = workData;
    }

    // 5. Extract education
    onProgress?.('Extracting education...', 86);
    const educationQuery = 'education academic background degrees university college school graduation';
    const educationData = await this.extractWithRAG(
      educationQuery,
      `Extract ALL education entries.
Return JSON array: [{"school":"","degree":"","field":"","graduationYear":""}]`,
      5
    );
    if (educationData && Array.isArray(educationData)) {
      profile.education = educationData;
    }

    // 6. Extract certifications
    onProgress?.('Extracting certifications...', 89);
    const certificationsQuery = 'certifications certificates licenses credentials professional certifications';
    const certificationsData = await this.extractWithRAG(
      certificationsQuery,
      `Extract certifications and licenses.
Return JSON array of strings: ["AWS Certified Developer","PMP","Security+"]`,
      3
    );
    if (certificationsData && Array.isArray(certificationsData)) {
      profile.certifications = certificationsData;
    }

    // 7. Extract projects
    onProgress?.('Extracting projects...', 92);
    const projectsQuery = 'projects portfolio work side projects open source contributions';
    const projectsData = await this.extractWithRAG(
      projectsQuery,
      `Extract notable projects.
Return JSON array: [{"name":"","description":"","technologies":[]}]`,
      5
    );
    if (projectsData && Array.isArray(projectsData)) {
      profile.projects = projectsData;
    }

    // 8. Generate summary using most relevant chunks
    onProgress?.('Generating summary...', 95);
    const summaryQuery = 'professional summary profile overview career objective background';
    const summaryChunks = await this.retrieveRelevantChunks(summaryQuery, 3);
    const summaryContext = summaryChunks.map(c => c.text).join('\n');
    
    try {
      const summaryResponse = await ollama.chat([
        { role: 'system', content: 'Create a concise professional summary (2-3 sentences) highlighting key qualifications and experience.' },
        { role: 'user', content: `Resume excerpt:\n${summaryContext}` },
      ], { temperature: 0.3 });
      profile.summary = summaryResponse.trim();
    } catch {
      profile.summary = 'Experienced professional with diverse skills and achievements.';
    }

    onProgress?.('RAG parsing complete', 100);
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
