/**
 * Auto-fill form fields using user profile
 */

import type { FieldSchema, FillMapping } from './types';
import type { UserProfile } from './profile';
import { getCountryCode, getPhoneNumber, parsePhoneNumber } from './phone-parser';
import { validateFieldData } from './field-data-validator';

/**
 * Generate fill mappings from profile and form schema
 */
export function generateFillMappings(schema: FieldSchema[], profile: UserProfile): FillMapping[] {
  const mappings: FillMapping[] = [];
  
  for (const field of schema) {
    const value = matchFieldToProfile(field, profile);
    if (value !== null) {
      // Validate the value before adding to mappings
      const validation = validateFieldData(field, value);
      
      if (validation.isValid) {
        mappings.push({
          selector: field.selector,
          value,
        });
      } else {
        console.warn(
          `[Autofill] Skipping field "${field.label || field.selector}" - validation failed: ${validation.reason}`
        );
        
        // If there's a suggested fix, try using that
        if (validation.suggestedFix) {
          const retryValidation = validateFieldData(field, validation.suggestedFix);
          if (retryValidation.isValid) {
            console.log(`[Autofill] Using suggested fix for "${field.label}": ${validation.suggestedFix}`);
            mappings.push({
              selector: field.selector,
              value: validation.suggestedFix,
            });
          }
        }
      }
    }
  }
  
  return mappings;
}

/**
 * Match a form field to profile data
 */
function matchFieldToProfile(field: FieldSchema, profile: UserProfile): string | boolean | null {
  const label = (field.label || field.name || field.id || '').toLowerCase();
  const name = (field.name || '').toLowerCase();
  const id = (field.id || '').toLowerCase();
  
  // DEBUG: Log all field matching attempts for Self-ID fields
  const labelContainsSelfId = label.includes('hispanic') || label.includes('latino') || 
                                label.includes('race') || label.includes('ethnic') ||
                                label.includes('veteran') || label.includes('disability');
  if (labelContainsSelfId) {
    console.log('[Autofill] 🔍 Matching Self-ID field:', {
      label: field.label,
      name: field.name,
      id: field.id,
      labelLower: label,
      nameLower: name,
      idLower: id
    });
  }
  
  // First name
  if (matchesAny([label, name, id], ['first', 'fname', 'firstname', 'given'])) {
    return profile.personal.firstName;
  }
  
  // Last name
  if (matchesAny([label, name, id], ['last', 'lname', 'lastname', 'family', 'surname'])) {
    return profile.personal.lastName;
  }
  
  // Full name
  if (matchesAny([label, name, id], ['name', 'fullname', 'full_name']) && 
      !matchesAny([label, name, id], ['first', 'last', 'company'])) {
    return `${profile.personal.firstName} ${profile.personal.lastName}`;
  }
  
  // Email
  if (matchesAny([label, name, id], ['email', 'e-mail', 'mail'])) {
    return profile.personal.email;
  }
  
  // Phone - Country Code (separate field)
  if (matchesAny([label, name, id], ['country code', 'countrycode', 'country_code', 'phone_country', 'phonecountry', 'dialcode', 'dial code', 'dial_code', 'phone code', 'select country'])) {
    const code = getCountryCode(profile.personal.phone);
    
    // Check if this is a custom dropdown (type=text but has options)
    // Some fields expect full format: "United States (+1)"
    // Others expect just: "+1"
    // Check current value to determine expected format
    const currentValue = field.valuePreview || '';
    if (currentValue.includes('United States') || currentValue.includes('🇺🇸')) {
      // This field expects full country name format
      // Map common country codes to names
      const countryNames: Record<string, string> = {
        '+1': 'United States',
        '+44': 'United Kingdom',
        '+91': 'India',
        '+86': 'China',
        '+81': 'Japan',
        '+49': 'Germany',
        '+33': 'France',
        '+61': 'Australia',
        // Add more as needed
      };
      
      const countryName = countryNames[code];
      if (countryName) {
        return `${countryName} (${code})`; // Format: "United States (+1)"
      }
    }
    
    // Default: just return the code
    return code;
  }
  
  // Phone - Check if this is JUST the phone number field (without country code)
  if (matchesAny([label, name, id], ['phone', 'mobile', 'tel', 'telephone', 'cell', 'phone_number', 'phonenumber', 'mobile_number', 'mobilenumber'])) {
    // Try to detect if this is a split phone field by checking:
    // 1. Field type (tel fields are often split)
    // 2. Nearby labels/fields mentioning country code
    // 3. Field length (short fields suggest split)
    
    const fieldType = field.type;
    const maxLength = field instanceof HTMLInputElement ? field.maxLength : -1;
    
    // Check DOM for nearby country code field
    let hasCountryCodeField = false;
    try {
      // Look in the same form or parent container
      const container = typeof document !== 'undefined' ? 
        (field.closest?.('form') || field.closest?.('div[class*="form"]') || field.closest?.('fieldset') || document.body) : 
        null;
      
      if (container) {
        hasCountryCodeField = !!container.querySelector('[name*="country"][name*="code"], [name*="countrycode"], [id*="country"][id*="code"], [id*="countrycode"], [placeholder*="country code"], select[name*="country"]');
      }
    } catch (e) {
      // DOM not available, fallback
    }
    
    // Also check if max length suggests a local number (10-11 digits)
    const suggestsSplit = hasCountryCodeField || (maxLength > 0 && maxLength <= 11);
    
    if (suggestsSplit) {
      // Return just the phone number without country code
      return getPhoneNumber(profile.personal.phone);
    } else {
      // Return full phone number with country code
      const parsed = parsePhoneNumber(profile.personal.phone);
      return parsed.fullNumber;
    }
  }
  
  // Country field - MUST be strict
  if (matchesAny([label, name, id], ['country'])) {
    const labelLower = (label || '').toLowerCase();
    
    // Skip country fields - too risky without proper country detection
    console.log('[Autofill] Skipping country field (needs manual input or proper country detection)');
    return null;
  }
  
  // Phone country code dropdown - check if options look like country codes
  if ('options' in field && Array.isArray((field as any).options)) {
    const options = (field as any).options;
    const firstOptions = options.slice(0, 5).join(' ');
    const looksLikeCountryCodes = /\+\d{1,3}/.test(firstOptions) || 
                                  /[A-Z][a-z]+\+\d/.test(firstOptions);
    
    if (looksLikeCountryCodes) {
      console.log('[Autofill] Detected country code dropdown, extracting code from phone');
      // This is a phone country code dropdown
      const countryCode = getCountryCode(profile.personal.phone);
      
      // Find matching option
      const match = options.find((opt: string) => opt.includes(countryCode));
      if (match) {
        return match;
      }
      
      console.warn('[Autofill] Could not find country code in dropdown');
      return null;
    }
  }
  
  // ==========================================================================
  // SELF-ID FIELDS - CHECK THESE FIRST (before location/address)
  // ==========================================================================
  
  // Check selfId exists
  if (!profile.selfId) {
    // Initialize with defaults if not set
    profile.selfId = {
      gender: [],
      race: [],
      orientation: [],
      veteran: 'Decline to self-identify',
      transgender: 'Decline to self-identify',
      disability: 'Decline to self-identify'
    };
  }
  
  // Hispanic/Latino ethnicity (specific question) - CHECK FIRST!
  if (matchesAny([label, name, id], ['hispanic', 'latino', 'latina', 'latinx'])) {
    const labelLower = (label || '').toLowerCase();
    
    // STRICT: Only if label explicitly mentions hispanic/latino
    if (!labelLower.includes('hispanic') && !labelLower.includes('latino')) {
      // Don't match - might be part of another field name
      return null;
    }
    
    console.log('[Autofill] 🏁 Hispanic/Latino field detected (PRIORITY MATCH)');
    
    // Check if user's ethnicity data includes Hispanic/Latino
    const isHispanic = profile.selfId.race.some(r => 
      r.toLowerCase().includes('hispanic') || r.toLowerCase().includes('latino')
    );
    const returnValue = isHispanic ? 'Yes' : 'No';
    console.log('[Autofill] 🏁 Hispanic/Latino returning:', returnValue);
    return returnValue;
  }
  
  // Race/Ethnicity - CHECK EARLY!
  if (matchesAny([label, name, id], ['race', 'ethnicity', 'ethnic'])) {
    // STRICT: Only if label clearly mentions race/ethnicity
    const labelLower = (label || '').toLowerCase();
    if (!labelLower.includes('race') && !labelLower.includes('ethnic')) {
      return null;
    }
    
    console.log('[Autofill] Race/Ethnicity field detected (PRIORITY MATCH):', {
      fieldLabel: field.label,
      raceData: profile.selfId.race,
      firstValue: profile.selfId.race[0] || '(empty)'
    });
    
    if (field.type === 'checkbox' || field.type === 'radio') {
      const fieldValue = field.valuePreview || '';
      const fieldLabel = (field.label || '').toLowerCase();
      
      return profile.selfId.race.some(r => {
        const rLower = r.toLowerCase();
        return fieldValue.toLowerCase().includes(rLower) || 
               fieldLabel.includes(rLower) ||
               rLower.includes(fieldValue.toLowerCase());
      });
    }
    
    // For autocomplete/select fields with options, try to match
    if ('options' in field && Array.isArray((field as any).options)) {
      const options = (field as any).options;
      const value = profile.selfId.race[0] || '';
      const valueLower = value.toLowerCase();
      
      // Check if user declined to answer (multiple variations)
      const isDecline = valueLower.includes('decline') || 
                        valueLower.includes('not disclose') || 
                        valueLower.includes('choose not') ||
                        valueLower.includes('prefer not') ||
                        valueLower.includes("don't wish") ||
                        valueLower.includes('no answer');
      
      if (isDecline) {
        // Find "decline to answer" option in dropdown
        const declineOption = options.find((opt: string) => {
          const optLower = opt.toLowerCase();
          return optLower.includes('decline') || 
                 optLower.includes('not disclose') ||
                 optLower.includes('prefer not') ||
                 optLower.includes("don't wish") ||
                 optLower.includes('no answer');
        });
        
        if (declineOption) {
          console.log('[Autofill] ✅ Mapped "decline" variation to:', declineOption);
          return declineOption;
        }
      }
      
      // Try to find exact match in options
      const match = options.find((opt: string) => 
        opt.toLowerCase() === valueLower ||
        opt.toLowerCase().includes(valueLower) ||
        valueLower.includes(opt.toLowerCase())
      );
      
      if (match) {
        return match;
      }
      
      console.warn('[Autofill] Race value not found in dropdown options:', {
        profileValue: value,
        availableOptions: options.slice(0, 5)
      });
      return null;
    }
    
    // For text fields, validate the value makes sense
    const value = profile.selfId.race[0] || '';
    // Don't fill if value looks like wrong data (location, sponsorship, etc.)
    if (value && (
      value.toLowerCase().includes('palo alto') ||
      value.toLowerCase().includes('california') ||
      value.toLowerCase().includes('resident') ||
      value.toLowerCase().includes('citizen') ||
      value.toLowerCase().includes('sponsor') ||
      /^\d+$/.test(value) || // Just a number
      value.length > 50 // Too long to be a race option
    )) {
      console.warn('[Autofill] Race value looks suspicious (might be location/work auth):', value);
      return null; // Skip filling
    }
    
    return value;
  }
  
  // Veteran status - CHECK EARLY!
  if (matchesAny([label, name, id], ['veteran', 'military'])) {
    // STRICT: Only if label explicitly mentions veteran (not just contains "us" or "permanent")
    const labelLower = (label || '').toLowerCase();
    if (!labelLower.includes('veteran') && !labelLower.includes('military')) {
      return null; // Don't match if not clearly veteran question
    }
    
    // DEBUG: Log veteran status value
    console.log('[Autofill] Veteran status field detected (PRIORITY MATCH):', {
      fieldLabel: field.label,
      veteranValue: profile.selfId.veteran,
      valueType: typeof profile.selfId.veteran
    });
    
    if (field.type === 'radio' || field.type === 'checkbox') {
      const fieldValue = field.valuePreview || '';
      const fieldLabel = (field.label || '').toLowerCase();
      const veteranLower = profile.selfId.veteran.toLowerCase();
      
      return fieldValue.toLowerCase().includes(veteranLower) || 
             fieldLabel.includes(veteranLower) ||
             veteranLower.includes(fieldValue.toLowerCase());
    }
    
    // For autocomplete/select fields with options, match exactly
    if ('options' in field && Array.isArray((field as any).options)) {
      const options = (field as any).options;
      const value = profile.selfId.veteran;
      const valueLower = value.toLowerCase();
      
      // Handle common veteran status variations
      let searchValue = valueLower;
      if (valueLower.includes('not') && valueLower.includes('veteran')) {
        // "Not a veteran" -> look for "I am not a protected veteran", "No", etc.
        const noOption = options.find((opt: string) => {
          const optLower = opt.toLowerCase();
          return optLower === 'no' || 
                 (optLower.includes('not') && optLower.includes('veteran')) ||
                 optLower.includes('decline');
        });
        if (noOption) {
          console.log('[Autofill] ✅ Mapped "Not a veteran" to:', noOption);
          return noOption;
        }
      } else if (valueLower.includes('yes') || valueLower.includes('veteran')) {
        // "Yes" or contains "veteran" -> look for veteran options
        const yesOption = options.find((opt: string) => {
          const optLower = opt.toLowerCase();
          return optLower === 'yes' || 
                 (optLower.includes('veteran') && !optLower.includes('not'));
        });
        if (yesOption) {
          console.log('[Autofill] ✅ Mapped veteran status to:', yesOption);
          return yesOption;
        }
      }
      
      // Check if user declined to answer
      const isDecline = valueLower.includes('decline') || 
                        valueLower.includes('not disclose') || 
                        valueLower.includes('choose not') ||
                        valueLower.includes('prefer not');
      
      if (isDecline) {
        const declineOption = options.find((opt: string) => {
          const optLower = opt.toLowerCase();
          return optLower.includes('decline') || 
                 optLower.includes('not disclose') ||
                 optLower.includes('prefer not');
        });
        if (declineOption) {
          console.log('[Autofill] ✅ Mapped "decline" to:', declineOption);
          return declineOption;
        }
      }
      
      // Try to find exact match in options
      const match = options.find((opt: string) => 
        opt.toLowerCase() === valueLower ||
        opt.toLowerCase().includes(valueLower) ||
        valueLower.includes(opt.toLowerCase())
      );
      
      if (match) {
        return match;
      }
      
      console.warn('[Autofill] Veteran value not found in dropdown options:', {
        profileValue: value,
        availableOptions: options.slice(0, 5)
      });
      return null;
    }
    
    // For text fields, validate the value makes sense
    const value = profile.selfId.veteran;
    // Don't fill if value looks like wrong data
    if (value && (
      value.toLowerCase().includes('resident') ||
      value.toLowerCase().includes('citizen') ||
      value.toLowerCase().includes('sponsor') ||
      value.toLowerCase().includes('visa') ||
      /^\d+$/.test(value) // Just a number
    )) {
      console.warn('[Autofill] Veteran value looks suspicious (might be work auth):', value);
      return null; // Skip filling
    }
    
    return value;
  }
  
  // Disability status - CHECK EARLY!
  if (matchesAny([label, name, id], ['disability', 'disabled'])) {
    // STRICT: Only if label explicitly mentions disability
    const labelLower = (label || '').toLowerCase();
    if (!labelLower.includes('disability') && !labelLower.includes('disabled')) {
      return null; // Don't match if not clearly disability question
    }
    
    // DEBUG: Log disability status value
    console.log('[Autofill] Disability status field detected (PRIORITY MATCH):', {
      fieldLabel: field.label,
      disabilityValue: profile.selfId.disability,
      valueType: typeof profile.selfId.disability
    });
    
    if (field.type === 'radio' || field.type === 'checkbox') {
      const fieldValue = field.valuePreview || '';
      const fieldLabel = (field.label || '').toLowerCase();
      const disabilityLower = profile.selfId.disability.toLowerCase();
      
      return fieldValue.toLowerCase().includes(disabilityLower) || 
             fieldLabel.includes(disabilityLower) ||
             disabilityLower.includes(fieldValue.toLowerCase());
    }
    
    // For autocomplete/select fields with options, match exactly
    if ('options' in field && Array.isArray((field as any).options)) {
      const options = (field as any).options;
      const value = profile.selfId.disability;
      const valueLower = value.toLowerCase();
      
      // Handle common disability status variations
      if (valueLower === 'no' || valueLower.includes('no disability') || valueLower.includes('not disabled')) {
        // "No" -> look for "I do not have a disability", "No", etc.
        const noOption = options.find((opt: string) => {
          const optLower = opt.toLowerCase();
          return optLower === 'no' || 
                 (optLower.includes('not') && optLower.includes('disabilit')) ||
                 (optLower.includes('do not') && optLower.includes('disabilit')) ||
                 optLower.includes('decline');
        });
        if (noOption) {
          console.log('[Autofill] ✅ Mapped "No disability" to:', noOption);
          return noOption;
        }
      } else if (valueLower === 'yes' || valueLower.includes('have a disability') || valueLower.includes('disabled')) {
        // "Yes" -> look for "I have a disability", "Yes", etc.
        const yesOption = options.find((opt: string) => {
          const optLower = opt.toLowerCase();
          return optLower === 'yes' || 
                 (optLower.includes('have') && optLower.includes('disabilit')) ||
                 (optLower.includes('disabilit') && !optLower.includes('not'));
        });
        if (yesOption) {
          console.log('[Autofill] ✅ Mapped disability status to:', yesOption);
          return yesOption;
        }
      }
      
      // Check if user declined to answer
      const isDecline = valueLower.includes('decline') || 
                        valueLower.includes('not disclose') || 
                        valueLower.includes('choose not') ||
                        valueLower.includes('prefer not');
      
      if (isDecline) {
        const declineOption = options.find((opt: string) => {
          const optLower = opt.toLowerCase();
          return optLower.includes('decline') || 
                 optLower.includes('not disclose') ||
                 optLower.includes('prefer not');
        });
        if (declineOption) {
          console.log('[Autofill] ✅ Mapped "decline" to:', declineOption);
          return declineOption;
        }
      }
      
      // Try to find exact match in options
      const match = options.find((opt: string) => 
        opt.toLowerCase() === valueLower ||
        opt.toLowerCase().includes(valueLower) ||
        valueLower.includes(opt.toLowerCase())
      );
      
      if (match) {
        return match;
      }
      
      console.warn('[Autofill] Disability value not found in dropdown options:', {
        profileValue: value,
        availableOptions: options.slice(0, 5)
      });
      return null;
    }
    
    // For text fields, validate the value makes sense
    const value = profile.selfId.disability;
    // Don't fill if value looks like wrong data
    if (value && (
      value.toLowerCase().includes('resident') ||
      value.toLowerCase().includes('citizen') ||
      value.toLowerCase().includes('sponsor') ||
      value.toLowerCase().includes('visa') ||
      /^\d+$/.test(value) // Just a number
    )) {
      console.warn('[Autofill] Disability value looks suspicious (might be work auth):', value);
      return null; // Skip filling
    }
    
    return value;
  }
  
  // Gender (early check to avoid conflicts)
  if (matchesAny([label, name, id], ['gender'])) {
    const labelLower = (label || '').toLowerCase();
    
    // Exclude transgender-specific questions
    if (labelLower.includes('transgender') || labelLower.includes('trans')) {
      return null; // Handle separately
    }
    
    // For checkboxes/radio buttons, check if this specific option matches user's selections
    if (field.type === 'checkbox' || field.type === 'radio') {
      const fieldValue = field.valuePreview || '';
      const fieldLabel = (field.label || '').toLowerCase();
      
      // Check if any of the user's gender selections match this field's value or label
      return profile.selfId.gender.some(g => {
        const gLower = g.toLowerCase();
        return fieldValue.toLowerCase().includes(gLower) || 
               fieldLabel.includes(gLower) ||
               gLower.includes(fieldValue.toLowerCase());
      });
    }
    
    // For autocomplete/select fields with options, match exactly
    if ('options' in field && Array.isArray((field as any).options)) {
      const options = (field as any).options;
      const value = profile.selfId.gender[0] || '';
      
      // Try to find exact match in options
      const match = options.find((opt: string) => {
        const optLower = opt.toLowerCase();
        const valLower = value.toLowerCase();
        
        // Handle common variations
        if ((valLower.includes('man') || valLower.includes('male')) && 
            (optLower.includes('male') && !optLower.includes('female'))) {
          return true;
        }
        if ((valLower.includes('woman') || valLower.includes('female')) && 
            optLower.includes('female')) {
          return true;
        }
        if (valLower.includes('non-binary') && optLower.includes('non-binary')) {
          return true;
        }
        
        return optLower === valLower || 
               optLower.includes(valLower) || 
               valLower.includes(optLower);
      });
      
      if (match) {
        return match;
      }
      
      console.warn('[Autofill] Gender value not found in dropdown options');
      return null;
    }
    
    // For text fields, return first selection
    const value = profile.selfId.gender[0] || '';
    
    // Validate it's not wrong data
    if (value && (
      value.toLowerCase().includes('palo alto') ||
      value.toLowerCase().includes('resident') ||
      value.toLowerCase().includes('citizen') ||
      /^\d+$/.test(value)
    )) {
      console.warn('[Autofill] Gender value looks suspicious:', value);
      return null;
    }
    
    return value;
  }
  
  // ==========================================================================
  // END SELF-ID FIELDS
  // ==========================================================================
  
  // Location / City / Address
  // EXCLUDE if this is asking about work authorization/sponsorship or country
  if (matchesAny([label, name, id], ['location', 'city', 'address', 'where'])) {
    console.log('[Autofill] 📍 Location field matched:', {
      fieldLabel: field.label,
      returnValue: profile.personal.location || ''
    });
    const labelLower = (label || '').toLowerCase();
    
    // Don't match if this is asking for country
    if (labelLower.includes('country')) {
      return null;
    }
    
    // Don't match if this is really asking about work authorization
    if (labelLower.includes('sponsorship') || 
        labelLower.includes('visa') || 
        labelLower.includes('work authorization') ||
        (labelLower.includes('require') && labelLower.includes('work'))) {
      // Skip - this is work auth question, not location
      return null;
    }
    
    // Check if this dropdown actually has country codes as options
    if ('options' in field && Array.isArray((field as any).options)) {
      const options = (field as any).options;
      const firstOptions = options.slice(0, 5).join(' ');
      const looksLikeCountryCodes = /\+\d{1,3}/.test(firstOptions);
      
      if (looksLikeCountryCodes) {
        console.warn('[Autofill] Location field has country codes as options - skipping');
        return null;
      }
    }
    
    return profile.personal.location || '';
  }
  
  // LinkedIn
  if (matchesAny([label, name, id], ['linkedin', 'linked-in'])) {
    return profile.professional.linkedin || '';
  }
  
  // GitHub
  if (matchesAny([label, name, id], ['github', 'git'])) {
    return profile.professional.github || '';
  }
  
  // Portfolio / Website
  if (matchesAny([label, name, id], ['portfolio', 'website', 'site', 'web', 'personal site', 'blog'])) {
    // Check if label specifically says "website" (not "How did you hear")
    if (!label.includes('hear') && !label.includes('find') && !label.includes('source')) {
      const portfolioValue = profile.professional.portfolio || profile.professional.github || '';
      console.log('[Autofill] 🌐 Website/Portfolio field matched:', portfolioValue || '(empty)');
      return portfolioValue;
    }
  }
  
  // How did you hear about this job / Referral source
  if (matchesAny([label, name, id], ['hear', 'heard', 'find', 'source', 'referral', 'how did you'])) {
    const labelLower = label.toLowerCase();
    
    // Make sure it's asking "how did you hear/find"
    if (labelLower.includes('hear') || labelLower.includes('find') || labelLower.includes('source') || labelLower.includes('referral')) {
      // Common answers - return empty or a default
      // TODO: Could store this in profile.referralSource if needed
      return ''; // Let user fill manually or use Smart Suggestions
    }
  }
  
  // Years of experience
  if (matchesAny([label, name, id], ['experience', 'years', 'yoe'])) {
    const labelLower = (label || '').toLowerCase();
    
    // EXCLUDE self-ID questions
    if (labelLower.includes('transgender') || 
        labelLower.includes('veteran') ||
        labelLower.includes('disability') ||
        labelLower.includes('gender') ||
        labelLower.includes('identity')) {
      // This is a self-ID question, not experience
      return null;
    }
    
    return profile.professional.yearsOfExperience?.toString() || '';
  }
  
  // Education fields - be very strict
  if (matchesAny([label, name, id], ['school', 'university', 'college'])) {
    // Don't match if this looks like it's asking for something else
    const labelLower = (label || '').toLowerCase();
    if (labelLower.includes('high school') || labelLower.includes('name') || labelLower.includes('school')) {
      console.log('[Autofill] 🎓 School field detected, education data:', profile.education);
      // Find first non-empty school from education
      if (profile.education && profile.education.length > 0) {
        const validEntry = profile.education.find(edu => edu.school && edu.school.trim() !== '');
        if (validEntry) {
          console.log('[Autofill] 🎓 Returning school:', validEntry.school);
          return validEntry.school;
        }
      }
      console.log('[Autofill] ⚠️ No valid education data found in profile');
    }
    return null;
  }
  
  if (matchesAny([label, name, id], ['degree'])) {
    const labelLower = (label || '').toLowerCase();
    if (labelLower.includes('degree')) {
      console.log('[Autofill] 🎓 Degree field detected, education data:', profile.education);
      // Find first non-empty degree from education
      if (profile.education && profile.education.length > 0) {
        const validEntry = profile.education.find(edu => edu.degree && edu.degree.trim() !== '');
        if (validEntry) {
          console.log('[Autofill] 🎓 Returning degree:', validEntry.degree);
          return validEntry.degree;
        }
      }
      console.log('[Autofill] ⚠️ No valid education data found in profile');
    }
    return null;
  }
  
  if (matchesAny([label, name, id], ['discipline', 'major', 'field of study'])) {
    const labelLower = (label || '').toLowerCase();
    if (labelLower.includes('discipline') || labelLower.includes('major') || labelLower.includes('field')) {
      console.log('[Autofill] 🎓 Discipline field detected, education data:', profile.education);
      // Find first non-empty field from education
      if (profile.education && profile.education.length > 0) {
        const validEntry = profile.education.find(edu => edu.field && edu.field.trim() !== '');
        if (validEntry) {
          console.log('[Autofill] 🎓 Returning discipline:', validEntry.field);
          return validEntry.field;
        }
      }
      console.log('[Autofill] ⚠️ No valid education data found in profile');
    }
    return null;
  }
  
  // Cover letter / Summary / About / Why questions
  if (field.tagName === 'TEXTAREA') {
    const labelLower = (label || '').toLowerCase();
    
    // Only match if it's clearly asking for a summary/bio/cover letter
    if (labelLower.includes('cover') || 
        labelLower.includes('letter') || 
        labelLower.includes('why') ||
        (labelLower.includes('about') && labelLower.includes('yourself')) ||
        labelLower.includes('bio') ||
        labelLower.includes('summary') ||
        labelLower.includes('motivation')) {
      
      // For "Why" questions, generate a template response
      if (labelLower.includes('why')) {
        // Extract company name from label if possible
        const companyMatch = field.label?.match(/why.*?(?:work at|join)\s+([A-Z][a-zA-Z]+)/i);
        const companyName = companyMatch ? companyMatch[1] : 'this company';
        
        // Use summary if available, otherwise generate template
        if (profile.summary && profile.summary.length > 50) {
          return `I'm excited about the opportunity to work at ${companyName}. ${profile.summary}`;
        } else {
          return `I'm passionate about joining ${companyName} because of its innovative work and commitment to excellence. With my background and skills, I believe I can contribute meaningfully to the team's success.`;
        }
      }
      
      return profile.summary || '';
    }
  }

  // Relocation / Willing to relocate questions
  if (matchesAny([label, name, id], ['relocate', 'relocation', 'willing to move', 'based in', 'currently located', 'located in'])) {
    const labelLower = label.toLowerCase();
    
    // "Are you currently located in the US?"
    if (labelLower.includes('located in') || labelLower.includes('currently in')) {
      // Check if asking about US specifically
      if (labelLower.includes(' us') || labelLower.includes('united states') || labelLower.includes('u.s.') || labelLower.includes(' us?')) {
        // Check work auth status or location to infer
        if (profile.workAuth && profile.workAuth.currentStatus && 
            (profile.workAuth.currentStatus.includes('US') || profile.workAuth.currentStatus.includes('United States'))) {
          console.log('[Autofill] 🌎 US location question: Yes (based on work auth)');
          return 'Yes';
        }
        // Or check if location seems US-based
        const userLocation = (profile.personal.location || '').toLowerCase();
        if (userLocation && (userLocation.includes('ca') || userLocation.includes('california') || 
            userLocation.includes('ny') || userLocation.includes('texas') || userLocation.includes('usa') ||
            userLocation.includes('palo alto'))) {
          console.log('[Autofill] 🌎 US location question: Yes (based on location)');
          return 'Yes';
        }
      }
    }
    
    // "Are you currently based in or willing to relocate to X?"
    if (labelLower.includes('relocate') || labelLower.includes('willing') || labelLower.includes('based in')) {
      // Check if asking about specific location (e.g., Bay Area)
      const userLocation = (profile.personal.location || '').toLowerCase();
      
      // If asking about "Bay Area" or "San Francisco" and user is in Palo Alto
      if ((labelLower.includes('bay area') || labelLower.includes('san francisco')) && 
          (userLocation.includes('palo alto') || userLocation.includes('bay area') || userLocation.includes('san francisco'))) {
        console.log('[Autofill] 🌎 Bay Area relocation: Yes (already there)');
        return 'Yes'; // Already based there
      }
      
      // Default: willing to relocate (can be changed in profile later)
      console.log('[Autofill] 🌎 Relocation question: Yes (default)');
      return 'Yes';
    }
  }
  
  // Work Authorization fields (if user has provided this data)
  if (profile.workAuth) {
    console.log('[Autofill] 💼 Work Auth data available:', {
      legallyAuthorized: profile.workAuth.legallyAuthorized,
      requiresSponsorship: profile.workAuth.requiresSponsorship,
      currentStatus: profile.workAuth.currentStatus
    });
    
    // Legally authorized to work
    if (matchesAny([label, name, id], ['legally', 'authorized', 'legal', 'eligible', 'work authorization'])) {
      console.log('[Autofill] 💼 Matched work authorization field:', field.label);
      
      if (field.type === 'checkbox' || field.type === 'radio') {
        const fieldValue = (field.valuePreview || '').toLowerCase();
        const fieldLabel = (field.label || '').toLowerCase();
        
        // Check if this is asking for "yes" answer
        const isYesOption = fieldValue.includes('yes') || fieldLabel.includes('yes') || 
                           fieldValue.includes('authorized') || fieldValue.includes('eligible');
        const isNoOption = fieldValue.includes('no') || fieldLabel.includes('no');
        
        if (profile.workAuth.legallyAuthorized) {
          return isYesOption;
        } else {
          return isNoOption;
        }
      } else {
        // For select-one, autocomplete, or text fields - return Yes/No string
        const answer = profile.workAuth.legallyAuthorized ? 'Yes' : 'No';
        console.log('[Autofill] 💼 Returning work authorization answer:', answer);
        return answer;
      }
    }

    // Requires sponsorship
    if (matchesAny([label, name, id], ['sponsorship', 'visa', 'sponsor', 'work permit', 'require'])) {
      const labelLower = (label || '').toLowerCase();
      
      // Skip if this is asking about visa TYPE (handled below)
      if (matchesAny([label, name, id], ['type', 'kind', 'which'])) {
        // This is asking for visa type, not yes/no
        if (profile.workAuth.visaType) {
          return profile.workAuth.visaType;
        }
      } else {
        // Ensure this is really a sponsorship YES/NO question
        if (!labelLower.includes('sponsor') && !labelLower.includes('visa') && !labelLower.includes('require')) {
          return null; // Not specific enough
        }
        
        // This is asking yes/no about sponsorship requirement
        if (field.type === 'checkbox' || field.type === 'radio') {
          const fieldValue = (field.valuePreview || '').toLowerCase();
          const fieldLabel = (field.label || '').toLowerCase();
          
          const isYesOption = fieldValue.includes('yes') || fieldLabel.includes('yes') ||
                             fieldValue.includes('require') || fieldValue.includes('need');
          const isNoOption = fieldValue.includes('no') || fieldLabel.includes('no');
          
          if (profile.workAuth.requiresSponsorship) {
            return isYesOption;
          } else {
            return isNoOption;
          }
        } else if (field.type === 'select-one' || field.type === 'text') {
          // For text fields (custom dropdowns), return Yes/No
          const answer = profile.workAuth.requiresSponsorship ? 'Yes' : 'No';
          console.log('[Autofill] Sponsorship question detected, returning:', answer);
          return answer;
        }
      }
    }

    // Current work status
    if (matchesAny([label, name, id], ['status', 'citizenship', 'citizen', 'resident', 'permanent'])) {
      if (profile.workAuth.currentStatus) {
        return profile.workAuth.currentStatus;
      }
    }

    // Visa type
    if (matchesAny([label, name, id], ['visa type', 'visa', 'h-1b', 'opt', 'cpt', 'immigration'])) {
      if (profile.workAuth.visaType) {
        return profile.workAuth.visaType;
      }
    }

    // Sponsorship timeline
    if (matchesAny([label, name, id], ['when', 'timeline', 'timeframe', 'how soon'])) {
      if (profile.workAuth.sponsorshipTimeline) {
        return profile.workAuth.sponsorshipTimeline;
      }
    }
  }
  
  // NOTE: Self-ID questions are now checked at the TOP of matchFieldToProfile()
  // (before location/address matchers) to prevent incorrect matches
  
  return null;
}

/**
 * Check if any of the texts match any of the patterns (HELPER MOVED FROM BELOW)
 */
function matchesAny(texts: string[], patterns: string[]): boolean {
  for (const text of texts) {
    for (const pattern of patterns) {
      if (text.includes(pattern)) {
        return true;
      }
    }
  }
  return false;
}
