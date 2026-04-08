# Figma Handoff Document - Offlyn Apply Browser Extension

## Project Overview
**Product:** Offlyn Apply - AI-powered job application automation browser extension
**Design Goal:** Create comprehensive UI mockups for complete product redesign
**Scope:** All user interfaces including extension pages and content script overlays

## Design System Requirements

### Visual Identity
- **Primary Colors:** Purple/Indigo (#7c3aed, #6d28d9)
- **Secondary Colors:** Green (success), Red (error), Yellow (warning), Blue (info)
- **Typography:** System font stack, clear hierarchy
- **Border Radius:** Consistent rounded corners
- **Shadows:** Subtle elevation for cards and overlays
- **Z-index Strategy:** Content script overlays use high values (999999+)

### Layout Principles
- **Extension Pages:** Max-width containers, responsive design
- **Popup:** Fixed 320px width constraint
- **Content Script UI:** Fixed positioning, non-intrusive placement
- **Accessibility:** High contrast ratios, keyboard navigation support

## Figma File Structure

### Page 1: Information Architecture & Sitemap
**Purpose:** Overall product structure and navigation relationships

**Artboards to Include:**
1. **Extension Page Hierarchy**
   - Popup as central hub
   - Full-page extensions branching from popup
   - Modal and overlay relationships

2. **Content Script UI System**
   - Widget as primary interface
   - Panel overlays and notifications
   - Interaction with host page content

3. **User Journey Map**
   - First-time setup path
   - Daily usage patterns
   - Feature discovery flows

### Page 2: Complete User Flows
**Purpose:** End-to-end user journeys with decision points

**Flow Diagrams to Create:**

#### Flow 1: First-Time Setup (8 screens)
- Installation trigger → Onboarding launch
- Ollama setup → Resume upload → Parse progress
- Profile review → Links → Self-ID → Work auth
- Cover letter prefs → Success screen

#### Flow 2: Job Application Workflow (6 screens)
- Page detection → Widget appearance → Field analysis
- Auto-fill trigger → Progress display → Form completion
- Success state with review options

#### Flow 3: Cover Letter Generation (4 screens)
- Trigger → Panel open → Generation progress
- Result display with action options

#### Flow 4: Job Discovery Process (5 screens)
- Search form → Results loading → Job cards
- Save/Apply actions → External navigation

#### Flow 5: Profile Management (4 screens)
- Profile grid → New/Edit actions → Form completion
- Profile switching workflow

### Page 3: Screen Inventory
**Purpose:** Every screen with all possible states

**Screen Categories:**

#### Extension Pages (13 screens)
1. **Popup** - Default, loading, disabled, job detected, profile warning
2. **Onboarding** - All 8 steps plus error states
3. **Jobs** - Search form, results, saved, loading, empty
4. **Profiles** - Grid view, modal states, editing
5. **Resume Tailor** - Input, processing, results, offline
6. **Dashboard** - Kanban board, stats, editing, empty
7. **Settings** - Form sections, testing states, confirmations
8. **Chat** - Welcome, conversation, loading, offline
9. **Data Explorer** - Tabs, tables, loading, empty
10. **Home** - Marketing content, feature highlights
11. **Help** - Documentation, FAQs
12. **Privacy** - Policy content
13. **Job Detected** - Job info display, actions

#### Content Script Overlays (8 components)
1. **Compatibility Widget** - Collapsed pill, expanded panel, progress states
2. **Cover Letter Panel** - Generating, preview, actions, error
3. **Notifications** - Success, error, warning, info toasts
4. **Progress Indicator** - Linear progress, completion states
5. **Field Highlighter** - Blue (filling), green (success), red (error)
6. **Inline Suggestion Tiles** - AI fill badges on empty fields
7. **Tracking Badge** - Application detection indicator
8. **Fill Debug Panel** - "Why was this filled?" explanations

### Page 4: Component Library & Patterns
**Purpose:** Reusable design system components

**Component Categories:**

#### Navigation Components
- **Profile Switcher:** Dropdown with colored dots, names, roles
- **Tab Navigation:** Results/Saved tabs, data explorer tabs
- **Breadcrumbs:** Onboarding step indicators
- **Footer Links:** Consistent across pages

#### Data Display Components
- **Job Cards:** Title, company, location, compatibility score variants
- **Profile Cards:** Name, role, color coding, action buttons
- **Application Cards:** Status indicators, dates, pipeline stages
- **Statistics Cards:** Numbers with labels and trend indicators

#### Form Components
- **Search Forms:** Keyword inputs, location fields, filter toggles
- **Profile Forms:** Text inputs, file upload areas, validation states
- **Settings Forms:** Toggle switches, dropdown selectors
- **Modal Forms:** Compact dialog layouts

#### Feedback Components
- **Progress Indicators:** Linear bars, circular rings, percentage displays
- **Status Badges:** Connection indicators, score badges, state labels
- **Toast Notifications:** Four types with icons and auto-dismiss
- **Loading States:** Spinners, skeleton screens, progress text

#### Action Components
- **Primary Buttons:** Auto-Fill, Generate, Search, Save
- **Secondary Buttons:** Cancel, Close, Back, Skip
- **Icon Buttons:** Edit, delete, refresh, settings
- **Toggle Switches:** Binary preferences, feature flags

### Page 5: States & Edge Cases
**Purpose:** All possible UI states for comprehensive coverage

**State Categories:**

#### Loading States
- **Page Loading:** Skeleton screens, progress indicators
- **Data Loading:** Spinner overlays, loading text
- **Process Loading:** AI generation, file upload, form submission

#### Empty States
- **No Data:** Empty job results, no saved jobs, no applications
- **No Profile:** Missing profile warnings, setup prompts
- **No Connection:** Offline states, AI disconnected

#### Error States
- **Connection Errors:** API failures, network issues
- **Validation Errors:** Form field errors, required field highlighting
- **Process Errors:** Upload failures, generation errors, parse failures

#### Success States
- **Completion:** Setup finished, form filled, letter generated
- **Confirmation:** Actions completed, data saved, settings updated
- **Achievement:** Profile complete, job applied, milestone reached

#### Disabled States
- **Feature Disabled:** Extension off, AI offline, insufficient data
- **Permission Restricted:** No applicable restrictions identified
- **Conditional Disabled:** Context-dependent button states

### Page 6: Interactive Prototypes
**Purpose:** Clickable prototypes for key user journeys

**Prototype Recommendations:**

#### Primary Prototype: Job Application Flow
- Start: Job site visit → Widget appears
- Interaction: Auto-fill button → Progress → Completion
- Branch: Cover letter generation → Panel → Actions
- End: Form ready for submission

#### Secondary Prototype: First-Time Setup
- Start: Extension installation → Onboarding
- Interaction: Step-by-step wizard navigation
- Branch: Error handling and recovery
- End: Profile created and ready

#### Tertiary Prototype: Profile Management
- Start: Popup profile switcher
- Interaction: Manage profiles → CRUD operations
- Branch: New profile creation flow
- End: Active profile switched

## Design Specifications

### Responsive Behavior
- **Extension Pages:** Responsive down to 320px width
- **Popup:** Fixed 320px width, vertical scrolling as needed
- **Content Script:** Fixed positioning, adapts to viewport

### Animation Guidelines
- **Transitions:** 200-300ms ease-out for state changes
- **Loading:** Smooth progress animations, skeleton loading
- **Overlays:** Slide-in panels, fade-in modals
- **Micro-interactions:** Button hover states, form focus

### Accessibility Requirements
- **Color Contrast:** WCAG AA compliance minimum
- **Keyboard Navigation:** Tab order, focus indicators
- **Screen Readers:** Proper ARIA labels, semantic HTML
- **Reduced Motion:** Respect user preferences

## Technical Constraints

### Browser Extension Limitations
- **Popup Size:** Maximum 800x600px, typically 320px wide
- **Content Script:** Must not interfere with host page styles
- **Cross-Origin:** Limited access to external resources
- **Performance:** Minimal impact on page load times

### Implementation Notes
- **Shadow DOM:** Content script uses Shadow DOM for style isolation
- **CSS Prefixes:** All classes use 'ofl-' or 'offlyn-' prefix
- **Z-index Management:** High values for content script overlays
- **Style Injection:** Dynamic style tag injection for content script

## Content Requirements

### Copy and Messaging
- **Tone:** Professional but approachable, helpful
- **Error Messages:** Clear, actionable, non-technical
- **Success Messages:** Encouraging, specific about what happened
- **Empty States:** Motivational, with clear next steps

### Iconography
- **Style:** Consistent with purple/indigo theme
- **Usage:** Functional icons for actions, status indicators
- **Sources:** System icons preferred, custom icons for brand elements

### Imagery
- **Screenshots:** Product screenshots for help documentation
- **Illustrations:** Simple, on-brand illustrations for empty states
- **Logos:** Consistent brand application across all surfaces

## Handoff Deliverables

### For Developers
1. **Component Specifications:** Detailed specs for each reusable component
2. **State Documentation:** All possible states with triggers and transitions
3. **Interaction Patterns:** Hover states, focus states, active states
4. **Responsive Breakpoints:** How components adapt to different sizes

### For Product Team
1. **User Flow Validation:** Confirm all identified flows are complete
2. **Feature Gap Analysis:** Review missing screens and functionality
3. **Priority Recommendations:** Which screens/flows to implement first
4. **Success Metrics:** How to measure design effectiveness

### For QA Team
1. **Test Scenarios:** All user paths and edge cases to validate
2. **Browser Compatibility:** Chrome, Firefox, Edge testing requirements
3. **Device Testing:** Desktop, laptop, different screen sizes
4. **Accessibility Testing:** Screen reader, keyboard navigation validation

## Open Questions for Design Review

### Functionality Questions
1. **Dry Run Mode:** Should this be fully implemented with preview functionality?
2. **Shopping Helper:** How prominent should non-job form filling be?
3. **Workday Integration:** Is this a priority feature to complete?
4. **Multi-Profile UX:** How to make profile switching more intuitive?

### Design Questions
1. **Content Script Branding:** How prominent should Offlyn branding be on host pages?
2. **Mobile Responsiveness:** Should extension pages work well on mobile browsers?
3. **Dark Mode:** Full dark mode implementation or just toggle?
4. **Customization:** Should users be able to customize widget appearance?

### Technical Questions
1. **Performance Impact:** How to minimize impact on host page performance?
2. **Browser Compatibility:** Which browsers and versions to support?
3. **Accessibility Level:** WCAG AA or AAA compliance target?
4. **Internationalization:** Support for multiple languages?

## Success Criteria

### Design Success Metrics
- **User Comprehension:** Users understand each screen's purpose immediately
- **Task Completion:** Users can complete primary tasks without confusion
- **Error Recovery:** Users can recover from errors without frustration
- **Feature Discovery:** Users discover and adopt advanced features

### Implementation Success Metrics
- **Development Velocity:** Designs enable faster development cycles
- **Bug Reduction:** Comprehensive specs reduce implementation bugs
- **Consistency:** All screens feel like part of cohesive product
- **Maintainability:** Design system enables easy updates and additions

This handoff document provides the foundation for creating comprehensive, implementable designs that accurately represent the complete Offlyn Apply user experience while addressing technical constraints and business requirements.