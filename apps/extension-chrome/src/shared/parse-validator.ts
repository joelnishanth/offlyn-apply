/**
 * Parse Validation & Comparison
 * 
 * Compares results from multiple parsing methods and validates accuracy
 */

import type { UserProfile } from './profile';
import { mastraAgent as ollama } from './mastra-agent';
import { ragParser } from './rag-parser';

export interface ParseComparison {
  ragResult: any;
  legacyResult: any;
  merged: any;
  differences: ParseDifference[];
  confidence: number;
}

export interface ParseDifference {
  field: string;
  ragValue: any;
  legacyValue: any;
  recommended: 'rag' | 'legacy' | 'manual';
  reason: string;
}

export class ParseValidator {
  /**
   * Parse with both methods and compare
   */
  async parseDual(
    resumeText: string,
    onProgress?: (stage: string, percent: number) => void
  ): Promise<ParseComparison> {
    console.log('[Validator] Starting dual parsing...');

    // Parse with both methods in parallel
    onProgress?.('Parsing with RAG...', 30);
    const ragPromise = ragParser.parseResume(resumeText, (stage, percent) => {
      onProgress?.(`RAG: ${stage}`, 30 + percent * 0.3);
    });

    onProgress?.('Parsing with legacy...', 60);
    const legacyPromise = ollama.parseResume(resumeText, (stage, percent) => {
      onProgress?.(`Legacy: ${stage}`, 60 + percent * 0.2);
    });

    const [ragResult, legacyResult] = await Promise.all([ragPromise, legacyPromise]);

    onProgress?.('Comparing results...', 90);

    // Compare and merge
    const differences = this.compareResults(ragResult, legacyResult);
    const merged = this.mergeResults(ragResult, legacyResult, differences);
    const confidence = this.calculateConfidence(differences);

    console.log('[Validator] Dual parsing complete');
    console.log(`[Validator] Found ${differences.length} differences, confidence: ${(confidence * 100).toFixed(1)}%`);

    return {
      ragResult,
      legacyResult,
      merged,
      differences,
      confidence,
    };
  }

  /**
   * Merge two already-parsed profiles without calling the parsers again.
   * Used when the caller runs both parsers externally (e.g. in parallel).
   */
  merge(ragResult: any, legacyResult: any): ParseComparison {
    const differences = this.compareResults(ragResult, legacyResult);
    const merged = this.mergeResults(ragResult, legacyResult, differences);
    const confidence = this.calculateConfidence(differences);

    console.log(`[Validator] Merged — ${differences.length} differences, confidence: ${(confidence * 100).toFixed(1)}%`);
    return { ragResult, legacyResult, merged, differences, confidence };
  }

  /**
   * Compare two parse results
   */
  private compareResults(rag: any, legacy: any): ParseDifference[] {
    const differences: ParseDifference[] = [];

    // Compare personal info
    if (rag.personal && legacy.personal) {
      for (const key of Object.keys({ ...rag.personal, ...legacy.personal })) {
        const ragVal = rag.personal[key];
        const legacyVal = legacy.personal[key];

        if (this.isDifferent(ragVal, legacyVal)) {
          differences.push({
            field: `personal.${key}`,
            ragValue: ragVal,
            legacyValue: legacyVal,
            recommended: this.recommendBetter(ragVal, legacyVal, 'string'),
            reason: this.explainDifference(ragVal, legacyVal),
          });
        }
      }
    }

    // Compare professional info
    if (rag.professional && legacy.professional) {
      for (const key of Object.keys({ ...rag.professional, ...legacy.professional })) {
        const ragVal = rag.professional[key];
        const legacyVal = legacy.professional[key];

        if (this.isDifferent(ragVal, legacyVal)) {
          differences.push({
            field: `professional.${key}`,
            ragValue: ragVal,
            legacyValue: legacyVal,
            recommended: this.recommendBetter(ragVal, legacyVal, 'mixed'),
            reason: this.explainDifference(ragVal, legacyVal),
          });
        }
      }
    }

    // Compare arrays (skills, work, education)
    if (rag.skills && legacy.skills) {
      const skillDiff = this.compareArrays(rag.skills, legacy.skills);
      if (skillDiff.different) {
        differences.push({
          field: 'skills',
          ragValue: rag.skills,
          legacyValue: legacy.skills,
          recommended: skillDiff.longer === 'rag' ? 'rag' : 'legacy',
          reason: `RAG found ${rag.skills.length} skills, Legacy found ${legacy.skills.length}`,
        });
      }
    }

    if (rag.work && legacy.work) {
      const workDiff = this.compareArrays(rag.work, legacy.work);
      if (workDiff.different) {
        differences.push({
          field: 'work',
          ragValue: rag.work,
          legacyValue: legacy.work,
          recommended: this.recommendWorkExperience(rag.work, legacy.work),
          reason: `RAG found ${rag.work.length} jobs, Legacy found ${legacy.work.length}`,
        });
      }
    }

    // Strip blank entries (e.g. {school:"", degree:"", field:"", graduationYear:""}) before comparing
    // so a RAG blank placeholder never causes "longer array wins" to pick legacy hallucinations
    const validEdu = (arr: any[]) => (arr || []).filter(e => e.school?.trim() || e.degree?.trim());
    const ragEdu = validEdu(rag.education);
    const legacyEdu = validEdu(legacy.education);
    if (ragEdu.length > 0 || legacyEdu.length > 0) {
      const eduDiff = this.compareArrays(ragEdu, legacyEdu);
      if (eduDiff.different) {
        differences.push({
          field: 'education',
          ragValue: ragEdu,
          legacyValue: legacyEdu,
          recommended: eduDiff.longer === 'rag' ? 'rag' : 'legacy',
          reason: `RAG found ${ragEdu.length} valid entries, Legacy found ${legacyEdu.length}`,
        });
      }
    }

    return differences;
  }

  /**
   * Check if two values are different
   */
  private isDifferent(a: any, b: any): boolean {
    if (a === b) return false;
    if (!a && !b) return false;
    if (!a || !b) return true;

    if (typeof a === 'string' && typeof b === 'string') {
      return a.trim().toLowerCase() !== b.trim().toLowerCase();
    }

    return JSON.stringify(a) !== JSON.stringify(b);
  }

  /**
   * Compare two arrays
   */
  private compareArrays(a: any[], b: any[]): { different: boolean; longer: 'rag' | 'legacy' | 'same' } {
    if (a.length === b.length) {
      return { different: JSON.stringify(a) !== JSON.stringify(b), longer: 'same' };
    }
    
    return {
      different: true,
      longer: a.length > b.length ? 'rag' : 'legacy',
    };
  }

  /**
   * Recommend better value
   */
  private recommendBetter(ragVal: any, legacyVal: any, type: 'string' | 'mixed'): 'rag' | 'legacy' | 'manual' {
    // If one is empty, use the other
    if (!ragVal && legacyVal) return 'legacy';
    if (ragVal && !legacyVal) return 'rag';

    // For strings, prefer longer and more detailed
    if (type === 'string') {
      const ragLen = String(ragVal || '').length;
      const legacyLen = String(legacyVal || '').length;
      
      if (ragLen > legacyLen * 1.5) return 'rag';
      if (legacyLen > ragLen * 1.5) return 'legacy';
    }

    // If similar, prefer RAG (more accurate semantic retrieval)
    return 'rag';
  }

  /**
   * Recommend better work experience.
   *
   * Quality signal priority:
   *  1. More entries with a valid startDate (dated entries are real jobs;
   *     undated entries are phantom sub-responsibilities from LLM hallucination)
   *  2. Higher total description length among the dated entries (more detail)
   *  3. Prefer RAG as tiebreaker (semantic retrieval is more precise)
   *
   * Intentionally does NOT prefer the side with a higher raw entry count,
   * because a result with 17 entries (12 phantom) is strictly worse than
   * one with 5 well-dated entries.
   */
  private recommendWorkExperience(ragWork: any[], legacyWork: any[]): 'rag' | 'legacy' | 'manual' {
    const hasDates = (jobs: any[]) => jobs.filter(j => j.startDate && String(j.startDate).trim());

    const ragDated   = hasDates(ragWork);
    const legacyDated = hasDates(legacyWork);

    // If legacy has 3x more dated entries than RAG and RAG has at least 2 entries,
    // legacy is almost certainly duplicating across overlapping chunks — trust RAG
    if (legacyDated.length > ragDated.length * 3 && ragDated.length >= 2) {
      return 'rag';
    }

    // If RAG found 0 work entries (model returned bad JSON / empty) but legacy has many,
    // we can't verify — still prefer legacy but the caller will cap the array
    if (ragWork.length === 0 && legacyWork.length > 0) {
      return 'legacy';
    }

    if (ragDated.length !== legacyDated.length) {
      return ragDated.length > legacyDated.length ? 'rag' : 'legacy';
    }

    const ragDetail    = ragDated.reduce((s, j) => s + (j.description?.length || 0), 0);
    const legacyDetail = legacyDated.reduce((s, j) => s + (j.description?.length || 0), 0);

    if (ragDetail > legacyDetail * 1.2) return 'rag';
    if (legacyDetail > ragDetail * 1.2) return 'legacy';

    return 'rag';
  }

  /**
   * Explain difference
   */
  private explainDifference(ragVal: any, legacyVal: any): string {
    if (!ragVal) return 'Only Legacy found this value';
    if (!legacyVal) return 'Only RAG found this value';

    const ragLen = String(ragVal).length;
    const legacyLen = String(legacyVal).length;

    if (ragLen > legacyLen * 1.5) return 'RAG version is more detailed';
    if (legacyLen > ragLen * 1.5) return 'Legacy version is more detailed';

    return 'Different formats or interpretations';
  }

  /**
   * Merge results intelligently
   */
  private mergeResults(rag: any, legacy: any, differences: ParseDifference[]): any {
    const merged: any = {
      personal: {},
      professional: {},
      skills: [],
      work: [],
      education: [],
      summary: '',
    };

    // For each difference, use recommended value
    const recommendations = new Map(
      differences.map(d => [d.field, { source: d.recommended, value: d.recommended === 'rag' ? d.ragValue : d.legacyValue }])
    );

    // Merge personal
    merged.personal = this.mergeObject(rag.personal || {}, legacy.personal || {}, recommendations, 'personal');

    // Post-process: if the model bundled middle+last into lastName and middleName is blank,
    // split the first word into middleName (e.g. "Nishanth Ponukumatla" → mid:"Nishanth" last:"Ponukumatla")
    if (merged.personal.lastName && !merged.personal.middleName) {
      const parts = String(merged.personal.lastName).trim().split(/\s+/);
      if (parts.length >= 2) {
        merged.personal.middleName = parts[0];
        merged.personal.lastName = parts.slice(1).join(' ');
      }
    }

    // Merge professional
    merged.professional = this.mergeObject(rag.professional || {}, legacy.professional || {}, recommendations, 'professional');

    // Merge skills (combine both, deduplicate)
    const allSkills = [
      ...(rag.skills || []),
      ...(legacy.skills || []),
    ];
    merged.skills = Array.from(new Set(allSkills.map(s => s.toLowerCase())))
      .map(s => allSkills.find(skill => skill.toLowerCase() === s) || s);

    // Merge work (use recommended); cap at 8 to prevent hallucinated entries from inflating the list
    const workRec = recommendations.get('work');
    const rawWork = workRec ? workRec.value : (rag.work || legacy.work || []);
    merged.work = rawWork.slice(0, 8);

    // Merge education (use recommended, otherwise fall back to whichever has valid entries)
    const eduRec = recommendations.get('education');
    merged.education = eduRec
      ? eduRec.value
      : (rag.education || legacy.education || []).filter((e: any) => e.school?.trim() || e.degree?.trim());

    // Summary (prefer RAG)
    merged.summary = rag.summary || legacy.summary || '';

    // Add metadata
    merged._metadata = {
      parsedWith: 'dual',
      ragFields: this.countFields(rag),
      legacyFields: this.countFields(legacy),
      mergedFields: this.countFields(merged),
      differences: differences.length,
    };

    return merged;
  }

  /**
   * Merge object fields
   */
  private mergeObject(
    ragObj: any,
    legacyObj: any,
    recommendations: Map<string, any>,
    prefix: string
  ): any {
    const merged: any = {};
    const allKeys = new Set([...Object.keys(ragObj), ...Object.keys(legacyObj)]);

    for (const key of allKeys) {
      const field = `${prefix}.${key}`;
      const rec = recommendations.get(field);

      if (rec) {
        merged[key] = rec.value;
      } else {
        // No difference, use RAG if available, else legacy
        merged[key] = ragObj[key] || legacyObj[key];
      }
    }

    return merged;
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(differences: ParseDifference[]): number {
    if (differences.length === 0) return 1.0; // Perfect match

    // Start with base confidence
    let confidence = 0.9;

    // Reduce confidence for each difference
    for (const diff of differences) {
      if (diff.field.startsWith('personal')) {
        confidence -= 0.05; // Personal info differences are important
      } else if (diff.field === 'work' || diff.field === 'education') {
        confidence -= 0.03; // Array differences less critical
      } else {
        confidence -= 0.02;
      }

      // If manual review needed, reduce more
      if (diff.recommended === 'manual') {
        confidence -= 0.05;
      }
    }

    return Math.max(0.5, confidence); // Minimum 50% confidence
  }

  /**
   * Count non-empty fields
   */
  private countFields(obj: any): number {
    let count = 0;

    const countInObject = (o: any): void => {
      for (const value of Object.values(o)) {
        if (value === null || value === undefined || value === '') continue;
        
        if (Array.isArray(value)) {
          count += value.length;
        } else if (typeof value === 'object') {
          countInObject(value);
        } else {
          count++;
        }
      }
    };

    countInObject(obj);
    return count;
  }

  /**
   * Validate profile completeness
   */
  validateProfile(profile: any): {
    complete: boolean;
    missing: string[];
    warnings: string[];
  } {
    const missing: string[] = [];
    const warnings: string[] = [];

    // Check required fields
    if (!profile.personal?.firstName) missing.push('First Name');
    if (!profile.personal?.lastName) missing.push('Last Name');
    if (!profile.personal?.email) missing.push('Email');
    if (!profile.personal?.phone) missing.push('Phone');

    // Check important fields
    if (!profile.work || profile.work.length === 0) warnings.push('No work experience found');
    if (!profile.education || profile.education.length === 0) warnings.push('No education found');
    if (!profile.skills || profile.skills.length === 0) warnings.push('No skills found');

    // Check for name quality
    const lastName = profile.personal?.lastName || '';
    if (lastName.includes(' ') && !profile.personal?.middleName) {
      warnings.push(`lastName "${lastName}" appears to contain a middle name — check firstName/middleName/lastName split`);
    }

    // Check for incomplete or phantom work entries
    const phantomJobs = (profile.work || []).filter((j: any) => !j.startDate || !String(j.startDate).trim());
    if (phantomJobs.length > 0) {
      warnings.push(`${phantomJobs.length} work entries have no startDate and will be treated as phantom entries`);
    }
    for (const job of (profile.work || [])) {
      if (!job.company) warnings.push('Some work entries missing company name');
      if (!job.description || job.description.length < 20) {
        warnings.push('Some work entries missing detailed descriptions');
      }
    }

    return {
      complete: missing.length === 0,
      missing,
      warnings,
    };
  }
}

// Singleton instance
export const parseValidator = new ParseValidator();
