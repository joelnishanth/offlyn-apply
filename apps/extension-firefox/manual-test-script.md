# Manual Test Script for Cover Letter Functionality

## Test Environment
- Firefox with Offlyn extension loaded
- Test file: test-workauth.html

## Test Cases

### 1. Initial Field Summary Display
- [ ] Load test-workauth.html
- [ ] Verify field summary panel appears
- [ ] Verify panel auto-minimizes after 3 seconds
- [ ] Click minimized cube to expand
- [ ] Verify panel expands and auto-minimizes again after 5 seconds

### 2. Cover Letter Generation - First Time
- [ ] Click "Generate Cover Letter" button in field summary
- [ ] Verify cover letter panel opens
- [ ] Verify generation starts (loading state)
- [ ] Wait for generation to complete
- [ ] Verify cover letter text appears

### 3. Duplicate Generation Prevention
- [ ] While cover letter is generating, click "Generate Cover Letter" again
- [ ] Verify no duplicate generation starts
- [ ] Verify existing panel remains visible

### 4. Back Button Navigation
- [ ] From cover letter panel, click "Back" button
- [ ] Verify cover letter panel closes
- [ ] Verify field summary panel expands
- [ ] Verify field summary does NOT auto-minimize (stays expanded)

### 5. Cover Letter Caching
- [ ] Generate cover letter once (complete generation)
- [ ] Close cover letter panel
- [ ] Click "Generate Cover Letter" again
- [ ] Verify cached result shows immediately (no regeneration)

### 6. Regeneration
- [ ] From cover letter panel, click "Regenerate" button
- [ ] Verify new generation starts
- [ ] Verify cache is cleared and fresh content generated

## Expected Results
All checkboxes should be checked for the functionality to be considered working correctly.

## Notes
- Record any unexpected behavior
- Note performance issues
- Document any UI/UX problems