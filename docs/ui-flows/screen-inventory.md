# Screen Inventory - Offlyn Apply Browser Extension

## Extension Pages (Browser Tabs)

### 1. Browser Popup
**Screen Name:** Main Control Popup  
**Route:** Browser toolbar action popup  
**Feature Area:** Navigation Hub  
**Primary User Goal:** Quick access to extension features and job application actions  
**Key Components:** Profile switcher, job status bar, action buttons, navigation grid, stats cards, Ollama status  
**Primary Actions:** Auto-fill form, generate cover letter, switch profiles  
**Secondary Actions:** Navigate to other pages, toggle extension, view advanced options  
**States:** Default, loading, disabled, job detected, profile incomplete, new jobs available  
**Transitions To:** All other extension pages, content script actions  
**Notes for Designer:** Fixed 320px width constraint, vertical scrolling for advanced panel  

### 2. Onboarding Wizard
**Screen Name:** Setup & Profile Management  
**Route:** `/onboarding/onboarding.html?profileId=&edit=true`  
**Feature Area:** User Setup  
**Primary User Goal:** Complete initial setup or edit existing profile  
**Key Components:** Multi-step wizard, progress indicators, file upload, form fields, status messages  
**Primary Actions:** Upload resume, configure AI, edit profile data, advance steps  
**Secondary Actions:** Skip optional steps, go back, start fresh  
**States:** Fresh setup (8 steps), edit mode, learned values only, upload progress, parse success/error  
**Transitions To:** Success completion, popup return, profiles page  
**Notes for Designer:** Step-by-step flow with clear progress indication, error recovery paths  

### 3. Job Discovery
**Screen Name:** Find Jobs  
**Route:** `/jobs/jobs.html`  
**Feature Area:** Job Search  
**Primary User Goal:** Discover relevant job opportunities  
**Key Components:** Search form, job cards, compatibility scores, tabs (Results/Saved)  
**Primary Actions:** Search jobs, save jobs, apply to external jobs  
**Secondary Actions:** Filter results, sort by match, switch tabs, clear saved  
**States:** Empty search, loading results, results populated, empty results, saved jobs  
**Transitions To:** External job sites, resume tailor (with job context)  
**Notes for Designer:** Compatibility scoring is key differentiator, emphasize match percentages  

### 4. Profile Management
**Screen Name:** Manage Profiles  
**Route:** `/profiles/profiles.html`  
**Feature Area:** Profile CRUD  
**Primary User Goal:** Create, edit, and switch between professional profiles  
**Key Components:** Profile cards grid, active profile banner, new profile modal  
**Primary Actions:** Create profile, activate profile, edit profile, delete profile  
**Secondary Actions:** Clone profile, inline rename, manage profile colors  
**States:** Single profile, multiple profiles, creating new, editing existing, modal open  
**Transitions To:** Onboarding (edit mode), popup (profile switched)  
**Notes for Designer:** Visual distinction between active/inactive profiles, color coding system  

### 5. Resume Tailoring
**Screen Name:** Tailor Resume  
**Route:** `/resume-tailor/resume-tailor.html`  
**Feature Area:** Resume Optimization  
**Primary User Goal:** Optimize resume for specific job description  
**Key Components:** Dual-panel layout, Ollama status, keyword analysis, result panel  
**Primary Actions:** Scrape job description, tailor resume, export result  
**Secondary Actions:** Manual input, keyword analysis, copy text  
**States:** Empty, loaded content, tailoring in progress, results ready, AI offline  
**Transitions To:** Export/download, copy completion  
**Notes for Designer:** Side-by-side comparison layout, keyword gap visualization  

### 6. Application Dashboard
**Screen Name:** Track Applications  
**Route:** `/dashboard/dashboard.html`  
**Feature Area:** Pipeline Management  
**Primary User Goal:** Monitor and manage job application pipeline  
**Key Components:** Kanban board, statistics overview, application cards, edit modal  
**Primary Actions:** View applications, edit status, delete applications  
**Secondary Actions:** Export data, search/filter, bulk actions  
**States:** Empty pipeline, populated board, editing application, loading  
**Transitions To:** Application edit modal, external job sites  
**Notes for Designer:** Kanban-style layout with drag-and-drop potential, clear status progression  

### 7. Settings & Configuration
**Screen Name:** Extension Settings  
**Route:** `/settings/settings.html`  
**Feature Area:** Configuration  
**Primary User Goal:** Configure extension preferences and integrations  
**Key Components:** Toggle switches, form sections, Ollama config, danger zone  
**Primary Actions:** Save settings, test connections, configure AI  
**Secondary Actions:** Clear data, export profile, reset preferences  
**States:** Default, testing connection, clearing data, confirmation dialogs  
**Transitions To:** Onboarding (re-setup), confirmation dialogs  
**Notes for Designer:** Group related settings, clear visual hierarchy, prominent danger zone  

### 8. AI Chat Interface
**Screen Name:** Chat with Resume  
**Route:** `/chat/chat.html`  
**Feature Area:** AI Assistance  
**Primary User Goal:** Get AI-powered career advice and resume insights  
**Key Components:** Chat thread, input area, sample questions, profile status  
**Primary Actions:** Ask questions, send messages, view responses  
**Secondary Actions:** Use sample questions, clear chat history  
**States:** Welcome screen, active conversation, loading response, AI offline, no profile  
**Transitions To:** Continuous conversation, profile setup if needed  
**Notes for Designer:** Chat interface patterns, clear AI vs user message distinction  

### 9. Data Explorer
**Screen Name:** View Profile Data  
**Route:** `/data/data.html`  
**Feature Area:** Data Transparency  
**Primary User Goal:** Understand what data is stored and how AI makes decisions  
**Key Components:** Tab navigation, data tables, visualization cards  
**Primary Actions:** Browse data sections, export information  
**Secondary Actions:** Switch between data types, understand AI reasoning  
**States:** Loading, populated tables, empty sections  
**Transitions To:** Export downloads, profile editing  
**Notes for Designer:** Technical data presentation, make complex data accessible  

### 10. Product Home
**Screen Name:** Product Overview  
**Route:** `/home/home.html`  
**Feature Area:** Marketing  
**Primary User Goal:** Understand product features and capabilities  
**Key Components:** Feature highlights, roadmap items, version info  
**Primary Actions:** Learn about features, navigate to specific functions  
**Secondary Actions:** View roadmap, check version info  
**States:** Static content display  
**Transitions To:** Other extension pages based on feature interest  
**Notes for Designer:** Marketing-focused layout, feature showcases, engaging visuals  

### 11. Help & Documentation
**Screen Name:** Help Center  
**Route:** `/help/help.html`  
**Feature Area:** Support  
**Primary User Goal:** Get help with using the extension  
**Key Components:** Documentation sections, FAQs, troubleshooting guides  
**Primary Actions:** Find answers, follow troubleshooting steps  
**Secondary Actions:** Contact support, report issues  
**States:** Static content with searchable sections  
**Transitions To:** Settings (for configuration), other pages for feature help  
**Notes for Designer:** Clear information hierarchy, searchable content, visual guides  

### 12. Privacy Policy
**Screen Name:** Privacy Information  
**Route:** `/privacy/privacy.html`  
**Feature Area:** Legal/Compliance  
**Primary User Goal:** Understand data privacy and usage policies  
**Key Components:** Policy text, data handling explanations  
**Primary Actions:** Read policy, understand data usage  
**Secondary Actions:** Navigate to settings for data controls  
**States:** Static content display  
**Transitions To:** Settings (data controls), contact information  
**Notes for Designer:** Legal document formatting, clear section breaks, accessible text  

### 13. Job Information Display
**Screen Name:** Job Details  
**Route:** `/job-detected/job-detected.html?tabId=`  
**Feature Area:** Job Context  
**Primary User Goal:** View detected job information and take action  
**Key Components:** Job card, company info, action buttons  
**Primary Actions:** Focus on job tab, set up profile  
**Secondary Actions:** Close information, navigate to related features  
**States:** Job loaded, loading, no job data (potentially broken)  
**Transitions To:** Original job tab, onboarding setup  
**Notes for Designer:** Simple job information card, clear call-to-action buttons  

## Content Script UI (Injected into Web Pages)

### 14. Compatibility Widget
**Screen Name:** Job Application Assistant  
**Route:** Injected on job application pages  
**Feature Area:** Form Assistance  
**Primary User Goal:** Get help with filling job application forms  
**Key Components:** Collapsed pill, expanded panel, compatibility score, profile switcher  
**Primary Actions:** Auto-fill form, generate cover letter, switch profiles  
**Secondary Actions:** Refresh scan, view compatibility details, collapse widget  
**States:** Collapsed pill, expanded panel, filling in progress, compatibility shown/hidden  
**Transitions To:** Cover letter panel, profile switching, form completion  
**Notes for Designer:** Non-intrusive when collapsed, helpful when expanded, Shadow DOM isolation  

### 15. Cover Letter Generation Panel
**Screen Name:** AI Cover Letter Creator  
**Route:** Slide-in overlay on job pages  
**Feature Area:** Cover Letter Generation  
**Primary User Goal:** Create personalized cover letter for specific job  
**Key Components:** Job context header, streaming text preview, action buttons  
**Primary Actions:** Generate letter, copy text, download file, apply to form  
**Secondary Actions:** Regenerate, refine content, close panel  
**States:** Generating (streaming), preview ready, error state, refining  
**Transitions To:** Form field population, file download, panel close  
**Notes for Designer:** Right-side slide panel, streaming text animation, clear action hierarchy  

### 16. Toast Notification System
**Screen Name:** Feedback Notifications  
**Route:** Stacked overlays on web pages  
**Feature Area:** User Feedback  
**Primary User Goal:** Receive feedback about actions and system status  
**Key Components:** Toast containers, icons, messages, dismiss buttons  
**Primary Actions:** Read message, dismiss notification  
**Secondary Actions:** Click for more details (context-dependent)  
**States:** Success, error, warning, info variants with auto-dismiss timers  
**Transitions To:** Auto-dismiss or manual close  
**Notes for Designer:** Non-blocking notifications, clear visual hierarchy, consistent with brand  

### 17. Progress Indicators
**Screen Name:** Action Progress Display  
**Route:** Overlay during form filling operations  
**Feature Area:** Process Feedback  
**Primary User Goal:** Understand progress of auto-fill operations  
**Key Components:** Progress bars, percentage displays, current action text  
**Primary Actions:** Monitor progress, cancel operation (if applicable)  
**Secondary Actions:** View detailed progress information  
**States:** In progress, completion, error during process  
**Transitions To:** Completion success state, error recovery  
**Notes for Designer:** Clear progress indication, reassuring during longer operations  

### 18. Field Highlighting System
**Screen Name:** Form Field Status Indicators  
**Route:** Applied to form fields during interaction  
**Feature Area:** Form Interaction  
**Primary User Goal:** Understand which fields are being processed and their status  
**Key Components:** Colored borders, temporary labels, status indicators  
**Primary Actions:** Visual feedback only (no user actions)  
**Secondary Actions:** None (purely visual)  
**States:** Blue (filling), green (success), red (error/validation)  
**Transitions To:** State changes based on fill progress and validation  
**Notes for Designer:** Subtle but clear visual feedback, doesn't interfere with host page design  

### 19. Inline Suggestion Tiles
**Screen Name:** AI Fill Suggestions  
**Route:** Positioned within empty form fields  
**Feature Area:** Smart Suggestions  
**Primary User Goal:** Get AI assistance for specific form fields  
**Key Components:** Small badges with "AI fill" text and icons  
**Primary Actions:** Click to get AI suggestion for field  
**Secondary Actions:** Dismiss suggestion, ignore tile  
**States:** Available, loading suggestion, suggestion provided, dismissed  
**Transitions To:** Field populated with suggestion, tile removal  
**Notes for Designer:** Subtle placement within fields, clear AI branding, non-intrusive  

### 20. Application Tracking Badge
**Screen Name:** Job Detection Indicator  
**Route:** Bottom-left corner of job pages  
**Feature Area:** Job Tracking  
**Primary User Goal:** Know that job application is being tracked  
**Key Components:** Small badge with job status, minimal branding  
**Primary Actions:** Acknowledge tracking (passive)  
**Secondary Actions:** Click for more details (if implemented)  
**States:** Job detected, application submitted, tracking active  
**Transitions To:** Remains visible during job application process  
**Notes for Designer:** Subtle presence indicator, builds trust in tracking functionality  

### 21. Fill Debug Panel
**Screen Name:** AI Decision Explanation  
**Route:** Dialog overlay triggered by context menu  
**Feature Area:** Transparency/Debug  
**Primary User Goal:** Understand why AI filled field with specific value  
**Key Components:** Dialog box, explanation text, data source indicators  
**Primary Actions:** Read explanation, close dialog  
**Secondary Actions:** Navigate to data source, provide feedback  
**States:** Explanation loaded, loading explanation, no explanation available  
**Transitions To:** Dialog close, potential navigation to profile data  
**Notes for Designer:** Technical information made accessible, clear explanation hierarchy  

## Modal and Overlay Components

### 22. New Profile Creation Modal
**Screen Name:** Create New Profile  
**Route:** Modal overlay on profiles page  
**Feature Area:** Profile Management  
**Primary User Goal:** Create new professional profile  
**Key Components:** Form fields, color picker, clone option, action buttons  
**Primary Actions:** Create profile, cancel creation  
**Secondary Actions:** Clone from existing profile, select color  
**States:** Empty form, validation errors, creating profile  
**Transitions To:** Profile created and added to grid, modal closed  
**Notes for Designer:** Clean modal design, clear form validation, color selection interface  

### 23. Application Edit Modal
**Screen Name:** Edit Application Details  
**Route:** Modal overlay on dashboard  
**Feature Area:** Application Management  
**Primary User Goal:** Update application information and status  
**Key Components:** Form fields, status dropdown, date pickers, action buttons  
**Primary Actions:** Save changes, delete application  
**Secondary Actions:** Cancel editing, change status  
**States:** Editing, validation errors, saving changes  
**Transitions To:** Application updated in dashboard, modal closed  
**Notes for Designer:** Form-focused modal, clear save/cancel actions, status progression  

### 24. Confirmation Dialogs
**Screen Name:** Action Confirmation  
**Route:** Modal overlays on various pages  
**Feature Area:** Data Safety  
**Primary User Goal:** Confirm destructive or important actions  
**Key Components:** Warning message, action description, confirm/cancel buttons  
**Primary Actions:** Confirm action, cancel action  
**Secondary Actions:** Learn more about consequences  
**States:** Warning display, processing confirmation  
**Transitions To:** Action executed or cancelled, dialog closed  
**Notes for Designer:** Clear warning design, emphasize destructive actions, easy cancellation  

### 25. Feature Tour Overlay
**Screen Name:** Guided Product Tour  
**Route:** Overlay system on popup and other pages  
**Feature Area:** Onboarding  
**Primary User Goal:** Learn how to use extension features  
**Key Components:** Highlighted elements, tooltip explanations, navigation controls  
**Primary Actions:** Advance tour, skip tour, complete tour  
**Secondary Actions:** Go back, pause tour, restart tour  
**States:** Tour active, tour paused, tour completed  
**Transitions To:** Next tour step, tour completion, normal app usage  
**Notes for Designer:** Non-intrusive highlighting, clear progression, easy escape option  

## State Variations Summary

### Loading States
- **Skeleton Screens:** Job cards, profile cards, dashboard columns
- **Progress Indicators:** File upload, AI processing, form filling
- **Spinner Overlays:** Page loading, data fetching, connection testing

### Empty States
- **No Data:** Empty job results, no saved jobs, no applications in pipeline
- **No Profile:** Missing profile warnings with setup prompts
- **No Connection:** AI offline, network issues, service unavailable

### Error States
- **Validation Errors:** Form field errors, required field highlighting
- **Connection Errors:** API failures, network timeouts, service errors
- **Process Errors:** Upload failures, AI generation errors, parse failures

### Success States
- **Completion:** Setup finished, form filled successfully, letter generated
- **Confirmation:** Settings saved, profile updated, application tracked
- **Achievement:** Milestones reached, goals completed, progress made

### Disabled States
- **Extension Disabled:** Master toggle off, features unavailable
- **Context Disabled:** Wrong page type, insufficient data, AI offline
- **Permission Disabled:** No applicable permission restrictions identified

## Design System Components

### Buttons
- **Primary:** Auto-Fill, Generate Cover Letter, Search, Save
- **Secondary:** Cancel, Close, Back, Skip, Edit
- **Icon Only:** Settings, Delete, Refresh, Help
- **Toggle:** Enable/Disable, Preferences, Feature Flags

### Form Elements
- **Text Inputs:** Keywords, names, descriptions
- **Textareas:** Job descriptions, cover letters, notes
- **Dropdowns:** Status selection, profile selection, filters
- **File Upload:** Resume upload with drag-and-drop
- **Toggles:** Binary preferences, feature switches
- **Color Picker:** Profile color selection

### Data Display
- **Cards:** Jobs, profiles, applications with consistent layout
- **Tables:** Data explorer, application lists, settings
- **Charts:** Dashboard statistics, compatibility scores
- **Badges:** Status indicators, scores, connection status
- **Progress:** Linear bars, circular rings, percentage displays

### Navigation
- **Tabs:** Results/Saved, data sections, content categories
- **Breadcrumbs:** Onboarding steps, process progression
- **Dropdowns:** Profile switcher, action menus
- **Links:** Footer navigation, help links, external sites

### Feedback
- **Toasts:** Success, error, warning, info with icons
- **Modals:** Confirmations, forms, detailed information
- **Overlays:** Loading states, blocking operations
- **Highlights:** Field states, active elements, focus indicators

This comprehensive screen inventory provides the detailed foundation needed for creating accurate, complete Figma mockups that represent every aspect of the Offlyn Apply user experience.