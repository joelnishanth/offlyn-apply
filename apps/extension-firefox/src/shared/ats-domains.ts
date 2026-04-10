/**
 * Single source of truth for ATS platform domains, job board domains,
 * and job-related URL patterns used for programmatic content script injection.
 *
 * Background script uses these to decide when to inject content.js via
 * chrome.scripting.executeScript instead of the old <all_urls> content_scripts
 * manifest entry.
 */

// ── ATS platform domains (suffix match: hostname === d || hostname.endsWith('.' + d)) ──

export const ATS_PLATFORM_DOMAINS: readonly string[] = [
  // Workday
  'workday.com',
  'myworkdayjobs.com',
  'myworkdaysite.com',
  // Greenhouse
  'greenhouse.io',
  // Lever
  'lever.co',
  // iCIMS
  'icims.com',
  // Taleo (Oracle)
  'taleo.net',
  // SAP SuccessFactors
  'successfactors.com',
  'successfactors.eu',
  // SmartRecruiters
  'smartrecruiters.com',
  // Jobvite
  'jobvite.com',
  // Ashby
  'ashbyhq.com',
  // BambooHR
  'bamboohr.com',
  // JazzHR
  'jazz.co',
  'jazzhr.com',
  // Workable
  'workable.com',
  // Breezy HR
  'breezy.hr',
  // Fountain
  'fountain.com',
  // Paylocity
  'paylocity.com',
  // UKG / UltiPro
  'ultipro.com',
  // ApplyToJob
  'applytojob.com',
  // Google Hire
  'hire.withgoogle.com',
  // Bullhorn
  'bullhorn.com',
  'bullhornstaffing.com',
  // Avature
  'avature.net',
  // Phenom
  'phenom.com',
  // Recruitee
  'recruitee.com',
  // Personio
  'personio.com',
  'personio.de',
  // Teamtailor
  'teamtailor.com',
  // Pinpoint
  'pinpointhq.com',
  // ClearCompany
  'clearcompany.com',
  // Rippling
  'rippling.com',
  // Cornerstone OnDemand
  'cornerstoneondemand.com',
  'csod.com',
  // Oracle HCM Cloud
  'oraclecloud.com',
  // PageUp
  'pageuppeople.com',
  // Eightfold
  'eightfold.ai',
  // Beamery
  'beamery.com',
  // Zoho Recruit
  'recruit.zoho.com',
  // Freshteam (Freshworks)
  'freshteam.com',
  // Manatal
  'manatal.com',
  // Hireology
  'hireology.com',
  // Hirebridge
  'hirebridge.com',
  // Newton Software
  'newtonsoftware.com',
  // SilkRoad
  'silkroad.com',
  // TalentSoft / Cegid
  'talentsoft.com',
  // Jobylon
  'jobylon.com',
  // Harri
  'harri.com',
  // ApplicantPro
  'applicantpro.com',
  // Dayforce / Ceridian
  'ceridian.com',
  'dayforce.com',
  // Paycom
  'paycom.com',
  'paycomonline.net',
  // ADP
  'adp.com',
  // Gusto
  'gusto.com',
  // Deel
  'deel.com',
  // Criteria
  'criteriacorp.com',
  // HireVue
  'hirevue.com',
  // Pymetrics
  'pymetrics.com',
  // Spark Hire
  'sparkhire.com',
  // VidCruiter
  'vidcruiter.com',
  // Homerun
  'homerun.co',
  // Comeet
  'comeet.com',
  // Recooty
  'recooty.com',
  // Loxo
  'loxo.co',
  // Gem
  'gem.com',
  // Fetcher
  'fetcher.ai',
  // Keka
  'keka.com',
  // Darwinbox
  'darwinbox.com',
  // NEOGOV
  'neogov.com',
  // Paycor
  'paycor.com',
  // Crelate
  'crelate.com',
  // Greenhouse variants
  'boards.eu.greenhouse.io',
  // Lever variants
  'hire.lever.co',
  // TalentLyft
  'talentlyft.com',
  // Breezy variants
  'app.breezy.hr',
  // Sap
  'sap.com',
  // Radancy (TMP Worldwide / TalentBrew)
  'radancy.net',
  // Jobadder
  'jobadder.com',
  // ApplicantStack
  'applicantstack.com',
  // Greenhouse Job Board API (some companies embed)
  'api.greenhouse.io',
];

// ── Job board domains ──

export const JOB_BOARD_DOMAINS: readonly string[] = [
  'indeed.com',
  'linkedin.com',
  'glassdoor.com',
  'ziprecruiter.com',
  'monster.com',
  'careerbuilder.com',
  'simplyhired.com',
  'dice.com',
  'wellfound.com',
  'joinhandshake.com',
  'themuse.com',
  'theladders.com',
  'otta.com',
  'builtin.com',
  'hired.com',
  'remotive.com',
  'weworkremotely.com',
  'flexjobs.com',
  'remote.co',
  'angel.co',
  'usajobs.gov',
  'governmentjobs.com',
  'hcareers.com',
  'arbeitnow.com',
  'adzuna.com',
  'roberthalfinternational.com',
  'roberthalf.com',
  'snagajob.com',
  'internships.com',
  'wayup.com',
  'idealist.org',
  'jobs.github.com',
  'stackoverflow.com',
  'talent.com',
  'reed.co.uk',
  'seek.com.au',
  'naukri.com',
  'stepstone.de',
  'totaljobs.com',
  'cwjobs.co.uk',
  'jobsite.co.uk',
  'jora.com',
  'careerjet.com',
  'jobberman.com',
  'bayt.com',
  'rozee.pk',
  'devjobsscanner.com',
  'nodesk.co',
  'workingnomads.com',
  'powertofly.com',
  'diversityintech.com',
  'techjobsforgood.com',
];

// ── Combined flat list (used for quick hostname checks) ──

export const ALL_DOMAINS: readonly string[] = [
  ...ATS_PLATFORM_DOMAINS,
  ...JOB_BOARD_DOMAINS,
];

// ── Job URL path patterns (match on any domain where we have permission) ──

export const JOB_URL_PATH_PATTERNS: readonly RegExp[] = [
  /\/jobs?\/[^/]+/i,
  /\/positions?\/[^/]+/i,
  /\/openings?\/[^/]+/i,
  /\/apply\b/i,
  /\/application\b/i,
  /\/publication\//i,
  /\/careers?\/.*apply/i,
  /\/recruitment\//i,
  /\/careers?\/[^/]+\/[^/]+/i,  // 2+ segments after /careers/ (e.g. /careers/engineering/sre-role)
  /\/(?:join-us|work-with-us|vacancies|opportunities)\/[^/]+/i,  // Alternative career terminology
];

// ── ATS query parameters (unambiguous signals that a company embeds an ATS) ──

export const ATS_QUERY_PARAMS: readonly string[] = [
  'gh_jid',          // Greenhouse job ID (e.g. databricks.com?gh_jid=8353049002)
  'gh_src',          // Greenhouse source tracking
  'lever_origin',    // Lever origin tracking
  'lever_source',    // Lever source tracking
  'ashby_jid',       // Ashby job ID
];

// ── Helper functions ──

export function isATSDomain(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return ALL_DOMAINS.some(d => h === d || h.endsWith('.' + d));
}

export function hasJobURLPath(url: string): boolean {
  return JOB_URL_PATH_PATTERNS.some(p => p.test(url));
}

/**
 * Returns true if the URL contains query parameters that indicate an embedded ATS.
 * These are unambiguous signals (e.g. gh_jid for Greenhouse) that won't false-positive.
 */
export function hasATSQueryParams(searchString: string): boolean {
  try {
    const params = new URLSearchParams(searchString);
    return ATS_QUERY_PARAMS.some(p => params.has(p));
  } catch {
    return false;
  }
}

/**
 * Returns true if the URL belongs to a known ATS/job-board domain,
 * its path matches job-related patterns, or it has ATS query parameters.
 * Used by the background script to decide when to inject content.js.
 */
export function isJobURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (isATSDomain(parsed.hostname)) return true;
    if (hasJobURLPath(parsed.pathname)) return true;
    if (hasATSQueryParams(parsed.search)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Generate manifest-compatible match patterns for host_permissions.
 * Each domain becomes `*://*.domain/*` to cover all subdomains.
 */
export function getManifestMatchPatterns(): string[] {
  return ALL_DOMAINS.map(d => `*://*.${d}/*`);
}
