/**
 * User profile management - stores extracted resume data
 */

import browser from './browser-compat';

export interface PhoneDetails {
  countryCode: string;   // e.g., "+1"
  number: string;        // e.g., "5551234567"
  formatted?: string;    // e.g., "+1 (555) 123-4567" (display only)
}

export interface LocationDetails {
  city: string;          // e.g., "San Francisco"
  state: string;         // e.g., "California" or "CA"
  country: string;       // e.g., "United States"
  zipCode?: string;      // e.g., "94103" (optional)
}

export interface SelfIdentification {
  gender: string[];
  race: string[];
  orientation: string[];
  veteran: string;
  transgender: string;
  disability: string;
  // Extended fields
  age?: number;
  ageRange?: string;         // e.g., "25-34"
  ethnicity?: string;        // e.g., "Hispanic or Latino", "Not Hispanic or Latino"
  citizenshipStatus?: string; // e.g., "US Citizen", "Permanent Resident"
}

// ── Type guards ─────────────────────────────────────────────────────────────

export function isPhoneDetails(phone: string | PhoneDetails): phone is PhoneDetails {
  return typeof phone === 'object' && phone !== null && 'countryCode' in phone && 'number' in phone;
}

export function isLocationDetails(location: string | LocationDetails): location is LocationDetails {
  return typeof location === 'object' && location !== null && 'city' in location && 'state' in location;
}

// ── Helper formatters ────────────────────────────────────────────────────────

export function formatPhone(phone: string | PhoneDetails): string {
  if (isPhoneDetails(phone)) {
    return phone.formatted || `${phone.countryCode} ${phone.number}`;
  }
  return phone;
}

export function formatLocation(location: string | LocationDetails): string {
  if (isLocationDetails(location)) {
    const parts = [location.city, location.state, location.country].filter(Boolean);
    return parts.join(', ');
  }
  return location;
}

export interface WorkAuthorization {
  requiresSponsorship: boolean;
  legallyAuthorized: boolean;
  visaType?: string; // e.g., "H-1B", "OPT", "CPT", "Green Card", "TN", "O-1", etc.
  sponsorshipTimeline?: string; // e.g., "Immediately", "Within 6 months", "Within 1 year"
  currentStatus?: string; // e.g., "US Citizen", "Permanent Resident", "Work Visa", "Student Visa"
}

export interface UserProfile {
  personal: {
    firstName: string;
    middleName?: string;
    lastName: string;
    email: string;
    phone: string | PhoneDetails;       // supports both string (legacy) and split object
    location: string | LocationDetails; // supports both string (legacy) and split object
  };
  professional: {
    linkedin?: string;
    github?: string;
    portfolio?: string;
    yearsOfExperience?: number;
  };
  work: Array<{
    company: string;
    title: string;
    startDate: string;
    endDate: string;
    current: boolean;
    description: string;
  }>;
  education: Array<{
    school: string;
    degree: string;
    field: string;
    graduationYear: string;
  }>;
  skills: string[];
  summary?: string;
  resumeText?: string; // Original resume text
  selfId?: SelfIdentification; // Optional self-identification data
  workAuth?: WorkAuthorization; // Work authorization and visa sponsorship info
  lastUpdated: number;
}

const PROFILE_KEY = 'userProfile';

/**
 * Get stored user profile
 */
export async function getUserProfile(): Promise<UserProfile | null> {
  try {
    const result = await browser.storage.local.get(PROFILE_KEY);
    return result[PROFILE_KEY] || null;
  } catch (err) {
    console.error('Failed to get profile:', err);
    return null;
  }
}

/**
 * Save user profile
 */
export async function saveUserProfile(profile: UserProfile): Promise<void> {
  try {
    profile.lastUpdated = Date.now();
    await browser.storage.local.set({ [PROFILE_KEY]: profile });
  } catch (err) {
    console.error('Failed to save profile:', err);
    throw err;
  }
}

/**
 * Clear user profile
 */
export async function clearUserProfile(): Promise<void> {
  try {
    await browser.storage.local.remove(PROFILE_KEY);
  } catch (err) {
    console.error('Failed to clear profile:', err);
    throw err;
  }
}

/**
 * Check if profile exists
 */
export async function hasUserProfile(): Promise<boolean> {
  const profile = await getUserProfile();
  return profile !== null;
}

export interface ProfileCompleteness {
  isComplete: boolean;
  missingFields: string[];
  filledFields: string[];
  completionPercentage: number;
}

/**
 * Check how complete a user profile is, listing which fields are missing.
 * Useful for showing warnings in the popup when key data is absent.
 */
export function checkProfileCompleteness(profile: UserProfile): ProfileCompleteness {
  const fields: Array<{ label: string; value: unknown }> = [
    { label: 'First Name', value: profile.personal.firstName },
    { label: 'Last Name', value: profile.personal.lastName },
    { label: 'Email', value: profile.personal.email },
    { label: 'Phone', value: formatPhone(profile.personal.phone) },
    { label: 'Location', value: formatLocation(profile.personal.location) },
    { label: 'LinkedIn', value: profile.professional?.linkedin },
    { label: 'GitHub', value: profile.professional?.github },
    { label: 'Portfolio', value: profile.professional?.portfolio },
    { label: 'Current Role', value: (profile.professional as any)?.currentRole },
    { label: 'Years of Experience', value: profile.professional?.yearsOfExperience },
  ];

  const filledFields: string[] = [];
  const missingFields: string[] = [];

  for (const f of fields) {
    if (f.value !== null && f.value !== undefined && String(f.value).trim() !== '') {
      filledFields.push(f.label);
    } else {
      missingFields.push(f.label);
    }
  }

  const completionPercentage = Math.round((filledFields.length / fields.length) * 100);

  return {
    isComplete: missingFields.length === 0,
    missingFields,
    filledFields,
    completionPercentage,
  };
}
