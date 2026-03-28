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

// ── Multi-profile system ────────────────────────────────────────────────────

export interface ProfileMeta {
  id: string;
  name: string;
  targetRole?: string;
  color: string;
  createdAt: number;
}

export interface ProfilesIndex {
  activeId: string;
  profiles: ProfileMeta[];
}

const LEGACY_PROFILE_KEY = 'userProfile';
const PROFILES_INDEX_KEY = 'profilesIndex';
const PROFILE_PREFIX = 'profile_';
const PROFILE_KEY = LEGACY_PROFILE_KEY;

const PROFILE_COLORS = [
  '#7c3aed', '#2563eb', '#059669', '#d97706',
  '#dc2626', '#8b5cf6', '#0891b2', '#be185d',
];

function profileStorageKey(id: string): string {
  return `${PROFILE_PREFIX}${id}`;
}

function generateProfileId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${slug}_${Date.now().toString(36)}`;
}

export async function getProfilesIndex(): Promise<ProfilesIndex | null> {
  try {
    const result = await browser.storage.local.get(PROFILES_INDEX_KEY);
    return result[PROFILES_INDEX_KEY] || null;
  } catch (err) {
    console.error('[Profile] Failed to get profiles index:', err);
    return null;
  }
}

export async function saveProfilesIndex(index: ProfilesIndex): Promise<void> {
  await browser.storage.local.set({ [PROFILES_INDEX_KEY]: index });
}

export async function getActiveProfileId(): Promise<string> {
  const index = await getProfilesIndex();
  return index?.activeId ?? 'default';
}

export async function setActiveProfile(id: string): Promise<void> {
  const index = await getProfilesIndex();
  if (!index) return;
  const exists = index.profiles.some(p => p.id === id);
  if (!exists) throw new Error(`Profile "${id}" does not exist`);
  index.activeId = id;
  await saveProfilesIndex(index);
}

export async function getProfileById(id: string): Promise<UserProfile | null> {
  try {
    const key = profileStorageKey(id);
    const result = await browser.storage.local.get(key);
    return result[key] || null;
  } catch (err) {
    console.error(`[Profile] Failed to get profile ${id}:`, err);
    return null;
  }
}

export async function saveProfileById(id: string, profile: UserProfile): Promise<void> {
  profile.lastUpdated = Date.now();
  await browser.storage.local.set({ [profileStorageKey(id)]: profile });
}

export async function createProfile(
  name: string,
  targetRole?: string,
  cloneFromId?: string,
): Promise<ProfileMeta> {
  const index = await getProfilesIndex() ?? {
    activeId: 'default',
    profiles: [],
  };

  const id = generateProfileId(name);
  const colorIndex = index.profiles.length % PROFILE_COLORS.length;
  const meta: ProfileMeta = {
    id,
    name,
    targetRole,
    color: PROFILE_COLORS[colorIndex],
    createdAt: Date.now(),
  };

  if (cloneFromId) {
    const source = await getProfileById(cloneFromId);
    if (source) {
      await saveProfileById(id, { ...source, lastUpdated: Date.now() });
    }
  }

  index.profiles.push(meta);
  await saveProfilesIndex(index);
  return meta;
}

export async function deleteProfile(id: string): Promise<void> {
  const index = await getProfilesIndex();
  if (!index) return;
  if (index.profiles.length <= 1) {
    throw new Error('Cannot delete the last profile');
  }
  index.profiles = index.profiles.filter(p => p.id !== id);
  if (index.activeId === id) {
    index.activeId = index.profiles[0].id;
  }
  await saveProfilesIndex(index);
  await browser.storage.local.remove(profileStorageKey(id));
}

export async function updateProfileMeta(
  id: string,
  updates: Partial<Pick<ProfileMeta, 'name' | 'targetRole' | 'color'>>,
): Promise<void> {
  const index = await getProfilesIndex();
  if (!index) return;
  const meta = index.profiles.find(p => p.id === id);
  if (!meta) throw new Error(`Profile "${id}" not found`);
  if (updates.name !== undefined) meta.name = updates.name;
  if (updates.targetRole !== undefined) meta.targetRole = updates.targetRole;
  if (updates.color !== undefined) meta.color = updates.color;
  await saveProfilesIndex(index);
}

export async function listProfiles(): Promise<ProfileMeta[]> {
  const index = await getProfilesIndex();
  return index?.profiles ?? [];
}

export async function migrateToMultiProfile(): Promise<void> {
  const existing = await getProfilesIndex();
  if (existing) return;

  const legacy = await (async () => {
    try {
      const result = await browser.storage.local.get(LEGACY_PROFILE_KEY);
      return result[LEGACY_PROFILE_KEY] as UserProfile | undefined;
    } catch { return undefined; }
  })();

  const meta: ProfileMeta = {
    id: 'default',
    name: 'Default',
    color: PROFILE_COLORS[0],
    createdAt: Date.now(),
  };

  const index: ProfilesIndex = { activeId: 'default', profiles: [meta] };
  await saveProfilesIndex(index);

  if (legacy) {
    await saveProfileById('default', legacy);
  }
}

/**
 * Get the active user profile. Multi-profile-aware.
 */
export async function getUserProfile(): Promise<UserProfile | null> {
  try {
    const index = await getProfilesIndex();
    if (index) {
      return await getProfileById(index.activeId);
    }
    const result = await browser.storage.local.get(PROFILE_KEY);
    return result[PROFILE_KEY] || null;
  } catch (err) {
    console.error('Failed to get profile:', err);
    return null;
  }
}

/**
 * Save the active user profile. Multi-profile-aware.
 */
export async function saveUserProfile(profile: UserProfile): Promise<void> {
  try {
    const index = await getProfilesIndex();
    if (index) {
      await saveProfileById(index.activeId, profile);
    } else {
      profile.lastUpdated = Date.now();
      await browser.storage.local.set({ [PROFILE_KEY]: profile });
    }
  } catch (err) {
    console.error('Failed to save profile:', err);
    throw err;
  }
}

/**
 * Clear the active user profile.
 */
export async function clearUserProfile(): Promise<void> {
  try {
    const index = await getProfilesIndex();
    if (index) {
      await browser.storage.local.remove(profileStorageKey(index.activeId));
    } else {
      await browser.storage.local.remove(PROFILE_KEY);
    }
  } catch (err) {
    console.error('Failed to clear profile:', err);
    throw err;
  }
}

/**
 * Check if the active profile exists.
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
