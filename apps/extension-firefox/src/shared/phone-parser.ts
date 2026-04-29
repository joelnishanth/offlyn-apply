/**
 * Phone number parsing utilities
 * Handles parsing phone numbers into country code and local number
 */

export interface ParsedPhoneNumber {
  countryCode: string;      // e.g., "+1", "+91", "+44"
  phoneNumber: string;       // e.g., "2432349871"
  formattedPhone: string;    // e.g., "(243) 234-9871"
  fullNumber: string;        // e.g., "+12432349871"
}

/**
 * Common country codes and their typical lengths
 */
const COUNTRY_CODES: { [key: string]: { code: string; length: number } } = {
  '1': { code: '+1', length: 10 },      // US, Canada
  '7': { code: '+7', length: 10 },      // Russia, Kazakhstan
  '20': { code: '+20', length: 10 },    // Egypt
  '27': { code: '+27', length: 9 },     // South Africa
  '30': { code: '+30', length: 10 },    // Greece
  '31': { code: '+31', length: 9 },     // Netherlands
  '32': { code: '+32', length: 9 },     // Belgium
  '33': { code: '+33', length: 9 },     // France
  '34': { code: '+34', length: 9 },     // Spain
  '39': { code: '+39', length: 10 },    // Italy
  '40': { code: '+40', length: 9 },     // Romania
  '41': { code: '+41', length: 9 },     // Switzerland
  '44': { code: '+44', length: 10 },    // UK
  '45': { code: '+45', length: 8 },     // Denmark
  '46': { code: '+46', length: 9 },     // Sweden
  '47': { code: '+47', length: 8 },     // Norway
  '48': { code: '+48', length: 9 },     // Poland
  '49': { code: '+49', length: 10 },    // Germany
  '51': { code: '+51', length: 9 },     // Peru
  '52': { code: '+52', length: 10 },    // Mexico
  '53': { code: '+53', length: 8 },     // Cuba
  '54': { code: '+54', length: 10 },    // Argentina
  '55': { code: '+55', length: 11 },    // Brazil
  '56': { code: '+56', length: 9 },     // Chile
  '57': { code: '+57', length: 10 },    // Colombia
  '58': { code: '+58', length: 10 },    // Venezuela
  '60': { code: '+60', length: 9 },     // Malaysia
  '61': { code: '+61', length: 9 },     // Australia
  '62': { code: '+62', length: 10 },    // Indonesia
  '63': { code: '+63', length: 10 },    // Philippines
  '64': { code: '+64', length: 9 },     // New Zealand
  '65': { code: '+65', length: 8 },     // Singapore
  '66': { code: '+66', length: 9 },     // Thailand
  '81': { code: '+81', length: 10 },    // Japan
  '82': { code: '+82', length: 10 },    // South Korea
  '84': { code: '+84', length: 9 },     // Vietnam
  '86': { code: '+86', length: 11 },    // China
  '90': { code: '+90', length: 10 },    // Turkey
  '91': { code: '+91', length: 10 },    // India
  '92': { code: '+92', length: 10 },    // Pakistan
  '93': { code: '+93', length: 9 },     // Afghanistan
  '94': { code: '+94', length: 9 },     // Sri Lanka
  '95': { code: '+95', length: 9 },     // Myanmar
  '98': { code: '+98', length: 10 },    // Iran
  '212': { code: '+212', length: 9 },   // Morocco
  '213': { code: '+213', length: 9 },   // Algeria
  '216': { code: '+216', length: 8 },   // Tunisia
  '218': { code: '+218', length: 9 },   // Libya
  '220': { code: '+220', length: 7 },   // Gambia
  '221': { code: '+221', length: 9 },   // Senegal
  '223': { code: '+223', length: 8 },   // Mali
  '224': { code: '+224', length: 9 },   // Guinea
  '225': { code: '+225', length: 10 },  // Ivory Coast
  '226': { code: '+226', length: 8 },   // Burkina Faso
  '227': { code: '+227', length: 8 },   // Niger
  '228': { code: '+228', length: 8 },   // Togo
  '229': { code: '+229', length: 8 },   // Benin
  '230': { code: '+230', length: 8 },   // Mauritius
  '231': { code: '+231', length: 8 },   // Liberia
  '232': { code: '+232', length: 8 },   // Sierra Leone
  '233': { code: '+233', length: 9 },   // Ghana
  '234': { code: '+234', length: 10 },  // Nigeria
  '235': { code: '+235', length: 8 },   // Chad
  '236': { code: '+236', length: 8 },   // Central African Republic
  '237': { code: '+237', length: 9 },   // Cameroon
  '238': { code: '+238', length: 7 },   // Cape Verde
  '239': { code: '+239', length: 7 },   // Sao Tome and Principe
  '240': { code: '+240', length: 9 },   // Equatorial Guinea
  '241': { code: '+241', length: 7 },   // Gabon
  '242': { code: '+242', length: 9 },   // Republic of Congo
  '243': { code: '+243', length: 9 },   // Democratic Republic of Congo
  '244': { code: '+244', length: 9 },   // Angola
  '245': { code: '+245', length: 7 },   // Guinea-Bissau
  '246': { code: '+246', length: 7 },   // British Indian Ocean Territory
  '248': { code: '+248', length: 7 },   // Seychelles
  '249': { code: '+249', length: 9 },   // Sudan
  '250': { code: '+250', length: 9 },   // Rwanda
  '251': { code: '+251', length: 9 },   // Ethiopia
  '252': { code: '+252', length: 8 },   // Somalia
  '253': { code: '+253', length: 8 },   // Djibouti
  '254': { code: '+254', length: 10 },  // Kenya
  '255': { code: '+255', length: 9 },   // Tanzania
  '256': { code: '+256', length: 9 },   // Uganda
  '257': { code: '+257', length: 8 },   // Burundi
  '258': { code: '+258', length: 9 },   // Mozambique
  '260': { code: '+260', length: 9 },   // Zambia
  '261': { code: '+261', length: 9 },   // Madagascar
  '262': { code: '+262', length: 9 },   // Reunion
  '263': { code: '+263', length: 9 },   // Zimbabwe
  '264': { code: '+264', length: 9 },   // Namibia
  '265': { code: '+265', length: 9 },   // Malawi
  '266': { code: '+266', length: 8 },   // Lesotho
  '267': { code: '+267', length: 8 },   // Botswana
  '268': { code: '+268', length: 8 },   // Swaziland
  '269': { code: '+269', length: 7 },   // Comoros
  '290': { code: '+290', length: 4 },   // Saint Helena
  '291': { code: '+291', length: 7 },   // Eritrea
  '297': { code: '+297', length: 7 },   // Aruba
  '298': { code: '+298', length: 6 },   // Faroe Islands
  '299': { code: '+299', length: 6 },   // Greenland
  '350': { code: '+350', length: 8 },   // Gibraltar
  '351': { code: '+351', length: 9 },   // Portugal
  '352': { code: '+352', length: 9 },   // Luxembourg
  '353': { code: '+353', length: 9 },   // Ireland
  '354': { code: '+354', length: 7 },   // Iceland
  '355': { code: '+355', length: 9 },   // Albania
  '356': { code: '+356', length: 8 },   // Malta
  '357': { code: '+357', length: 8 },   // Cyprus
  '358': { code: '+358', length: 9 },   // Finland
  '359': { code: '+359', length: 9 },   // Bulgaria
  '370': { code: '+370', length: 8 },   // Lithuania
  '371': { code: '+371', length: 8 },   // Latvia
  '372': { code: '+372', length: 8 },   // Estonia
  '373': { code: '+373', length: 8 },   // Moldova
  '374': { code: '+374', length: 8 },   // Armenia
  '375': { code: '+375', length: 9 },   // Belarus
  '376': { code: '+376', length: 6 },   // Andorra
  '377': { code: '+377', length: 8 },   // Monaco
  '378': { code: '+378', length: 10 },  // San Marino
  '380': { code: '+380', length: 9 },   // Ukraine
  '381': { code: '+381', length: 9 },   // Serbia
  '382': { code: '+382', length: 8 },   // Montenegro
  '383': { code: '+383', length: 8 },   // Kosovo
  '385': { code: '+385', length: 9 },   // Croatia
  '386': { code: '+386', length: 8 },   // Slovenia
  '387': { code: '+387', length: 8 },   // Bosnia and Herzegovina
  '389': { code: '+389', length: 8 },   // North Macedonia
  '420': { code: '+420', length: 9 },   // Czech Republic
  '421': { code: '+421', length: 9 },   // Slovakia
  '423': { code: '+423', length: 7 },   // Liechtenstein
  '500': { code: '+500', length: 5 },   // Falkland Islands
  '501': { code: '+501', length: 7 },   // Belize
  '502': { code: '+502', length: 8 },   // Guatemala
  '503': { code: '+503', length: 8 },   // El Salvador
  '504': { code: '+504', length: 8 },   // Honduras
  '505': { code: '+505', length: 8 },   // Nicaragua
  '506': { code: '+506', length: 8 },   // Costa Rica
  '507': { code: '+507', length: 8 },   // Panama
  '508': { code: '+508', length: 6 },   // Saint Pierre and Miquelon
  '509': { code: '+509', length: 8 },   // Haiti
  '590': { code: '+590', length: 9 },   // Guadeloupe
  '591': { code: '+591', length: 8 },   // Bolivia
  '592': { code: '+592', length: 7 },   // Guyana
  '593': { code: '+593', length: 9 },   // Ecuador
  '594': { code: '+594', length: 9 },   // French Guiana
  '595': { code: '+595', length: 9 },   // Paraguay
  '596': { code: '+596', length: 9 },   // Martinique
  '597': { code: '+597', length: 7 },   // Suriname
  '598': { code: '+598', length: 8 },   // Uruguay
  '599': { code: '+599', length: 7 },   // Netherlands Antilles
  '670': { code: '+670', length: 8 },   // Timor-Leste
  '672': { code: '+672', length: 6 },   // Australian External Territories
  '673': { code: '+673', length: 7 },   // Brunei
  '674': { code: '+674', length: 7 },   // Nauru
  '675': { code: '+675', length: 8 },   // Papua New Guinea
  '676': { code: '+676', length: 5 },   // Tonga
  '677': { code: '+677', length: 7 },   // Solomon Islands
  '678': { code: '+678', length: 7 },   // Vanuatu
  '679': { code: '+679', length: 7 },   // Fiji
  '680': { code: '+680', length: 7 },   // Palau
  '681': { code: '+681', length: 6 },   // Wallis and Futuna
  '682': { code: '+682', length: 5 },   // Cook Islands
  '683': { code: '+683', length: 4 },   // Niue
  '685': { code: '+685', length: 5 },   // Samoa
  '686': { code: '+686', length: 5 },   // Kiribati
  '687': { code: '+687', length: 6 },   // New Caledonia
  '688': { code: '+688', length: 5 },   // Tuvalu
  '689': { code: '+689', length: 8 },   // French Polynesia
  '690': { code: '+690', length: 4 },   // Tokelau
  '691': { code: '+691', length: 7 },   // Micronesia
  '692': { code: '+692', length: 7 },   // Marshall Islands
  '850': { code: '+850', length: 10 },  // North Korea
  '852': { code: '+852', length: 8 },   // Hong Kong
  '853': { code: '+853', length: 8 },   // Macau
  '855': { code: '+855', length: 9 },   // Cambodia
  '856': { code: '+856', length: 9 },   // Laos
  '880': { code: '+880', length: 10 },  // Bangladesh
  '886': { code: '+886', length: 9 },   // Taiwan
  '960': { code: '+960', length: 7 },   // Maldives
  '961': { code: '+961', length: 8 },   // Lebanon
  '962': { code: '+962', length: 9 },   // Jordan
  '963': { code: '+963', length: 9 },   // Syria
  '964': { code: '+964', length: 10 },  // Iraq
  '965': { code: '+965', length: 8 },   // Kuwait
  '966': { code: '+966', length: 9 },   // Saudi Arabia
  '967': { code: '+967', length: 9 },   // Yemen
  '968': { code: '+968', length: 8 },   // Oman
  '970': { code: '+970', length: 9 },   // Palestine
  '971': { code: '+971', length: 9 },   // United Arab Emirates
  '972': { code: '+972', length: 9 },   // Israel
  '973': { code: '+973', length: 8 },   // Bahrain
  '974': { code: '+974', length: 8 },   // Qatar
  '975': { code: '+975', length: 8 },   // Bhutan
  '976': { code: '+976', length: 8 },   // Mongolia
  '977': { code: '+977', length: 10 },  // Nepal
  '992': { code: '+992', length: 9 },   // Tajikistan
  '993': { code: '+993', length: 8 },   // Turkmenistan
  '994': { code: '+994', length: 9 },   // Azerbaijan
  '995': { code: '+995', length: 9 },   // Georgia
  '996': { code: '+996', length: 9 },   // Kyrgyzstan
  '998': { code: '+998', length: 9 },   // Uzbekistan
};

/**
 * Parse a phone number into components
 * Handles various formats:
 * - +12432349871
 * - +1 (243) 234-9871
 * - +1-243-234-9871
 * - 12432349871
 * - (243) 234-9871 (assumes US/Canada)
 * - 243-234-9871 (assumes US/Canada)
 */
export function parsePhoneNumber(phoneInput: string): ParsedPhoneNumber {
  // Remove all non-numeric characters except leading +
  let cleaned = phoneInput.trim();
  const hasPlus = cleaned.startsWith('+');
  
  // Extract just the digits
  const digitsOnly = cleaned.replace(/\D/g, '');
  
  if (!digitsOnly) {
    // Empty or invalid
    return {
      countryCode: '+1',
      phoneNumber: '',
      formattedPhone: '',
      fullNumber: phoneInput
    };
  }
  
  // Try to detect country code
  let countryCode = '+1'; // Default to US/Canada
  let phoneNumber = digitsOnly;
  
  if (hasPlus || digitsOnly.length > 10) {
    // Try to match country code
    // Check 3-digit codes first (e.g., +234)
    for (let len = 3; len >= 1; len--) {
      const possibleCode = digitsOnly.substring(0, len);
      if (COUNTRY_CODES[possibleCode]) {
        const info = COUNTRY_CODES[possibleCode];
        const remainingDigits = digitsOnly.substring(len);
        
        // Verify the remaining length matches expected
        if (remainingDigits.length === info.length || 
            Math.abs(remainingDigits.length - info.length) <= 1) {
          countryCode = info.code;
          phoneNumber = remainingDigits;
          break;
        }
      }
    }
    
    // If no match found but has too many digits, assume leading digit is country code
    if (phoneNumber === digitsOnly && digitsOnly.length > 10) {
      if (digitsOnly.startsWith('1') && digitsOnly.length === 11) {
        // US/Canada number with leading 1
        countryCode = '+1';
        phoneNumber = digitsOnly.substring(1);
      } else {
        // Generic fallback
        countryCode = '+' + digitsOnly[0];
        phoneNumber = digitsOnly.substring(1);
      }
    }
  }
  
  // Format the phone number (US format for now)
  let formattedPhone = phoneNumber;
  if (phoneNumber.length === 10) {
    // US format: (XXX) XXX-XXXX
    formattedPhone = `(${phoneNumber.substring(0, 3)}) ${phoneNumber.substring(3, 6)}-${phoneNumber.substring(6)}`;
  } else if (phoneNumber.length > 10) {
    // Generic format: XXX-XXX-XXXX-XXX...
    const parts = [];
    for (let i = 0; i < phoneNumber.length; i += 3) {
      parts.push(phoneNumber.substring(i, i + 3));
    }
    formattedPhone = parts.join('-');
  }
  
  return {
    countryCode,
    phoneNumber,
    formattedPhone,
    fullNumber: `${countryCode}${phoneNumber}`
  };
}

/**
 * Format phone number for display
 */
export function formatPhoneNumber(phoneInput: string, format: 'full' | 'local' | 'international' = 'full'): string {
  const parsed = parsePhoneNumber(phoneInput);
  
  switch (format) {
    case 'full':
      return parsed.fullNumber;
    case 'local':
      return parsed.formattedPhone;
    case 'international':
      return `${parsed.countryCode} ${parsed.formattedPhone}`;
    default:
      return phoneInput;
  }
}

/**
 * Get just the country code from a phone number
 */
export function getCountryCode(phoneInput: string): string {
  return parsePhoneNumber(phoneInput).countryCode;
}

/**
 * Get just the phone number (without country code)
 */
export function getPhoneNumber(phoneInput: string): string {
  return parsePhoneNumber(phoneInput).phoneNumber;
}

/**
 * Check if a string looks like a phone number
 */
export function looksLikePhoneNumber(input: string): boolean {
  const digitsOnly = input.replace(/\D/g, '');
  return digitsOnly.length >= 7 && digitsOnly.length <= 15;
}

/**
 * Normalize phone number to standard format
 */
export function normalizePhoneNumber(phoneInput: string): string {
  const parsed = parsePhoneNumber(phoneInput);
  return parsed.fullNumber;
}
