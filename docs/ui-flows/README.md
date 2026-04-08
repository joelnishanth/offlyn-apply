# UI Flow Documentation for Offlyn Apply

This folder contains comprehensive UI flow documentation for the Offlyn Apply browser extension, prepared for Figma design handoff.

## 📁 Files Overview

### 1. `ui-flow-audit.md` - Complete UI Flow Audit
**Purpose:** Comprehensive analysis of all UI flows extracted from the codebase
**Contents:**
- Product overview and user jobs to be done
- Complete route/screen inventory (25 screens)
- Detailed user flows (7 major journeys)
- Modal and overlay systems (25 components)
- State matrix for all screens
- Reusable component patterns
- Mermaid flow diagrams
- Identified gaps and missing functionality

### 2. `figma-handoff.md` - Figma Design Handoff Guide
**Purpose:** Structured guide for creating Figma mockups and prototypes
**Contents:**
- Design system requirements (colors, typography, layout)
- Recommended Figma file structure (6 pages)
- Technical constraints and implementation notes
- Content requirements and messaging guidelines
- Handoff deliverables for different teams
- Open questions for design review
- Success criteria and metrics

### 3. `screen-inventory.md` - Detailed Screen Specifications
**Purpose:** Comprehensive specifications for every UI screen and component
**Contents:**
- 13 extension pages with full specifications
- 8+ content script overlay components
- Modal and dialog variations
- Complete state variations (loading, empty, error, success)
- Design system component library
- Implementation notes for designers

### 4. `README.md` - This overview file

## 🎯 How to Use This Documentation

### For Designers
1. **Start with `figma-handoff.md`** - provides complete structure and requirements
2. **Reference `screen-inventory.md`** - for detailed specs of each screen
3. **Use `ui-flow-audit.md`** - for user journeys and interaction patterns

### For Product Managers
1. **Review user flows** in `ui-flow-audit.md` to validate completeness
2. **Check identified gaps** for feature prioritization decisions
3. **Use open questions** in `figma-handoff.md` for design review

### For Developers
1. **Technical constraints** in `figma-handoff.md` for implementation guidance
2. **Component specifications** in `screen-inventory.md` for development specs
3. **State matrix** in `ui-flow-audit.md` for handling all UI states

## 🔄 Two UI Systems

The extension operates on two distinct UI surfaces:

### Extension Pages (Browser Tabs)
- 13 full-page interfaces opened in browser tabs
- Traditional web page layouts with responsive design
- Consistent navigation and branding across pages

### Content Script UI (Injected Overlays)
- 8+ components injected into job application websites
- Shadow DOM isolation to prevent style conflicts
- High z-index positioning for proper layering

## 📊 Key Statistics

- **Total Screens:** 25 unique UI surfaces
- **User Flows:** 7 major user journeys documented
- **Components:** 50+ reusable UI components identified
- **States:** 5+ states per screen (loading, empty, error, success, disabled)
- **Modals/Overlays:** 25 modal and overlay components

## 🎨 Design Priorities

### Primary Flows (Design First)
1. **First-Time Setup** - 8-step onboarding wizard
2. **Job Application** - Auto-fill workflow with AI assistance
3. **Cover Letter Generation** - AI-powered personalization
4. **Profile Management** - Multi-profile switching and CRUD

### Secondary Flows
1. **Job Discovery** - Search with compatibility scoring
2. **Application Tracking** - Pipeline management dashboard
3. **Settings & Configuration** - Extension preferences

## 🚀 Getting Started

1. **Read the Figma Handoff Guide** first for overall approach
2. **Create Figma file structure** as recommended (6 pages)
3. **Start with primary user flows** for core functionality
4. **Design extension pages first**, then content script overlays
5. **Include all state variations** for comprehensive coverage

## ❓ Questions or Issues

If you need clarification on any aspect of the UI flows or have questions about specific screens or interactions, refer to the "Open Questions" section in `figma-handoff.md` or create new documentation as needed.

---

**Last Updated:** April 8, 2026  
**Source:** Complete codebase analysis of Offlyn Apply browser extension  
**Purpose:** Figma design handoff for product redesign