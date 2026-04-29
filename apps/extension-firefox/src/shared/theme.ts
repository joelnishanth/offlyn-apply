/**
 * Offlyn Apply Design System - Color Theme
 * 
 * Centralized color constants for consistent branding across all UI surfaces.
 * DO NOT use inline hex values - always import from this file.
 */

export const colors = {
  // Primary Brand Colors
  navy: '#1E2A3A',
  green: '#7CB342',
  greenDark: '#558B2F',
  white: '#FFFFFF',
  
  // Neutral Grays
  grayLight: '#F5F7FA',
  grayMedium: '#CBD5E1',
  grayDark: '#64748B',
  
  // Semantic Colors
  success: '#7CB342',
  error: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',
  
  // Status Colors (for dashboard)
  statusSubmitted: '#3B82F6',
  statusInterviewing: '#F59E0B',
  statusRejected: '#EF4444',
  statusAccepted: '#7CB342',
  statusWithdrawn: '#64748B',
  
  // Text Colors
  textPrimary: '#1E2A3A',
  textSecondary: '#64748B',
  textDisabled: '#CBD5E1',
  textInverse: '#FFFFFF',
  
  // Background Colors
  bgPrimary: '#FFFFFF',
  bgSecondary: '#F5F7FA',
  bgDark: '#1E2A3A',
  bgGreenTint: '#F0F7E8',
  
  // Border Colors
  borderLight: '#E5E7EB',
  borderMedium: '#CBD5E1',
  borderAccent: '#7CB342',
} as const;

/**
 * Computed colors (derived from primary colors)
 */
export const computed = {
  // Green variants (for hover states)
  greenHover: '#558B2F',
  greenActive: '#4A7A28',
  greenDisabled: '#CBD5E1',
  
  // Navy variants (for backgrounds)
  navyLight: '#2D4A5E',
  navyDark: '#0F172A',
  
  // Opacity variants
  navyAlpha10: 'rgba(30, 42, 58, 0.1)',
  navyAlpha15: 'rgba(30, 42, 58, 0.15)',
  navyAlpha20: 'rgba(30, 42, 58, 0.2)',
  navyAlpha30: 'rgba(30, 42, 58, 0.3)',
  navyAlpha50: 'rgba(30, 42, 58, 0.5)',
  
  greenAlpha10: 'rgba(124, 179, 66, 0.1)',
  greenAlpha20: 'rgba(124, 179, 66, 0.2)',
  greenAlpha30: 'rgba(124, 179, 66, 0.3)',
  greenAlpha50: 'rgba(124, 179, 66, 0.5)',
} as const;

/**
 * CSS custom properties for use in stylesheets
 */
export function getCSSVariables(): string {
  return `
    --color-navy: ${colors.navy};
    --color-green: ${colors.green};
    --color-white: ${colors.white};
    
    --color-gray-light: ${colors.grayLight};
    --color-gray-medium: ${colors.grayMedium};
    --color-gray-dark: ${colors.grayDark};
    
    --color-success: ${colors.success};
    --color-error: ${colors.error};
    --color-warning: ${colors.warning};
    --color-info: ${colors.info};
    
    --color-text-primary: ${colors.textPrimary};
    --color-text-secondary: ${colors.textSecondary};
    --color-text-disabled: ${colors.textDisabled};
    --color-text-inverse: ${colors.textInverse};
    
    --color-bg-primary: ${colors.bgPrimary};
    --color-bg-secondary: ${colors.bgSecondary};
    --color-bg-dark: ${colors.bgDark};
    --color-bg-green-tint: ${colors.bgGreenTint};
    
    --color-border-light: ${colors.borderLight};
    --color-border-medium: ${colors.borderMedium};
    --color-border-accent: ${colors.borderAccent};
    
    --color-green-hover: ${computed.greenHover};
    --color-green-active: ${computed.greenActive};
    --color-green-disabled: ${computed.greenDisabled};
  `.trim();
}

/**
 * Helper function to inject CSS variables into a style element
 */
export function injectThemeCSS(): void {
  const styleId = 'offlyn-apply-theme';
  
  // Remove existing theme if present
  document.getElementById(styleId)?.remove();
  
  // Inject new theme
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `:root { ${getCSSVariables()} }`;
  document.head.appendChild(style);
}

/**
 * Typography (optional - for consistency)
 */
export const typography = {
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  fontSizes: {
    xs: '11px',
    sm: '12px',
    base: '14px',
    lg: '16px',
    xl: '18px',
    '2xl': '24px',
    '3xl': '28px',
  },
} as const;

/**
 * Spacing (optional - for consistency)
 */
export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  '2xl': '32px',
} as const;

/**
 * Border radius (optional - for consistency)
 */
export const borderRadius = {
  sm: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '9999px',
} as const;
