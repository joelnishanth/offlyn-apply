/**
 * Cover letter generation service — uses Ollama to produce a tailored cover
 * letter from the user's profile/resume and the scraped job description.
 */

import type { UserProfile } from './profile';
import type { JobDescription } from './job-description-scraper';

const OLLAMA_BASE_URL = 'http://localhost:11434';
const MODEL = 'llama3.2';

export interface CoverLetterResult {
  text: string;          // the generated letter
  jobTitle: string;
  company: string;
  generatedAt: number;   // epoch ms
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a cover letter using Ollama.
 * Streams token-by-token and calls `onChunk` for live preview.
 */
export async function generateCoverLetter(
  profile: UserProfile,
  job: JobDescription,
  onChunk?: (partialText: string) => void,
): Promise<CoverLetterResult> {
  const prompt = buildPrompt(profile, job);

  // Use streaming for live preview
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, stream: true }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error ${response.status}: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    // Ollama streams JSON objects separated by newlines
    for (const line of chunk.split('\n').filter(Boolean)) {
      try {
        const obj = JSON.parse(line);
        if (obj.response) {
          fullText += obj.response;
          onChunk?.(fullText);
        }
      } catch { /* partial JSON — ignore */ }
    }
  }

  // Clean up
  fullText = cleanCoverLetter(fullText);

  return {
    text: fullText,
    jobTitle: job.title,
    company: job.company,
    generatedAt: Date.now(),
  };
}

/**
 * Refine an existing cover letter: shorten, lengthen, or make more impactful.
 * Streams token-by-token via `onChunk`.
 */
export async function refineCoverLetter(
  currentText: string,
  action: 'shorten' | 'lengthen' | 'impactful',
  onChunk?: (partialText: string) => void,
): Promise<string> {
  const instructions: Record<string, string> = {
    shorten:
      'Rewrite this cover letter to be shorter and more concise. ' +
      'Cut it down to 2-3 tight paragraphs (~150-200 words). Remove filler and keep only the strongest points. ' +
      'Maintain the same tone and key selling points.',
    lengthen:
      'Expand this cover letter with more detail and depth. ' +
      'Add 1-2 additional paragraphs (~350-450 words total). Elaborate on specific achievements with metrics where possible. ' +
      'Add a stronger closing paragraph. Maintain the same professional tone.',
    impactful:
      'Rewrite this cover letter to be significantly more compelling and impactful. ' +
      'Use stronger action verbs, quantify achievements, and make the opening hook more attention-grabbing. ' +
      'Add confident language that demonstrates clear value to the employer. Same length, just more powerful.',
  };

  const prompt = `You are refining an existing cover letter.

CURRENT COVER LETTER:
${currentText}

TASK:
${instructions[action]}

Rules:
1. Output ONLY the revised cover letter text. Nothing else.
2. Do NOT include any preamble like "Here is..." or "Sure, here's the revised version...".
3. Do NOT include date, addresses, "Dear Hiring Manager", or signature — just the body.
4. Keep the same factual content about the applicant — do NOT invent new experiences.
5. Write in first person.`;

  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, stream: true }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error ${response.status}: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n').filter(Boolean)) {
      try {
        const obj = JSON.parse(line);
        if (obj.response) {
          fullText += obj.response;
          onChunk?.(fullText);
        }
      } catch { /* partial JSON */ }
    }
  }

  return cleanCoverLetter(fullText);
}

// ── Prompt builder ──────────────────────────────────────────────────────────

function buildPrompt(profile: UserProfile, job: JobDescription): string {
  const name = `${profile.personal.firstName} ${profile.personal.lastName}`.trim();
  const email = profile.personal.email;
  const phone = profile.personal.phone;
  const location = profile.personal.location;

  // Build concise experience summary
  const experience = profile.work
    .slice(0, 3)
    .map(w => `${w.title} at ${w.company} (${w.startDate}–${w.endDate || 'Present'}): ${w.description.slice(0, 200)}`)
    .join('\n');

  const education = profile.education
    .slice(0, 2)
    .map(e => `${e.degree} in ${e.field}, ${e.school} (${e.graduationYear})`)
    .join('\n');

  const skills = profile.skills.slice(0, 20).join(', ');

  const summary = profile.summary || '';

  // Trim JD to avoid blowing context
  const jdText = job.description.slice(0, 4000);

  return `You are writing a professional cover letter for a job application.

APPLICANT INFORMATION:
- Name: ${name}
- Email: ${email}
- Phone: ${phone}
- Location: ${location}
${summary ? `- Professional Summary: ${summary}` : ''}

WORK EXPERIENCE:
${experience || 'Not provided'}

EDUCATION:
${education || 'Not provided'}

KEY SKILLS:
${skills || 'Not provided'}

JOB DETAILS:
- Position: ${job.title}
- Company: ${job.company}
${job.location ? `- Location: ${job.location}` : ''}

JOB DESCRIPTION:
${jdText}

INSTRUCTIONS:
Write a compelling, professional cover letter tailored to this specific position.

Rules:
1. Write in first person.
2. 3-4 paragraphs, roughly 250-350 words.
3. Opening: Express genuine interest in the specific role and company.
4. Body: Highlight 2-3 most relevant experiences/skills from the applicant's background that directly match the job requirements. Use specific examples.
5. Closing: Express enthusiasm and include a call to action.
6. Tone: Professional yet personable. Confident but not arrogant.
7. Do NOT include the date, recipient address, "Dear Hiring Manager" header, or closing signature — just the letter body.
8. Do NOT include any preamble like "Here is..." or "Sure, here's...".
9. Do NOT use placeholder text like [Company Name] — use the actual company name.
10. Output ONLY the cover letter text. Nothing else.`;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

function cleanCoverLetter(text: string): string {
  let cleaned = text.trim();

  // Strip common LLM preambles
  const preambles = [
    /^(here\s+(is|are)\s+.*?:\s*)/i,
    /^(sure[,!]?\s.*?:\s*)/i,
    /^(of\s+course[,!]?\s.*?:\s*)/i,
    /^(certainly[,!]?\s.*?:\s*)/i,
  ];
  for (const re of preambles) {
    cleaned = cleaned.replace(re, '');
  }

  // Remove surrounding quotes
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Fix literal \n to actual newlines
  cleaned = cleaned.replace(/\\n/g, '\n');

  // Normalize excessive blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}
