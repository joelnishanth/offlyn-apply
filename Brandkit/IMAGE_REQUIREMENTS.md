# Offlyn Apply - Image Asset Requirements

## Current Files in Brandkit/
- Offlyn_Apply_Monogram.png (OA monogram)
- Offlyn_Apply_Primary_Logo.png (Full logo with robot)
- offlyn-logo-3d.png (3D version)

---

## Required Image Exports

### 1. MONOGRAM ICONS (OA) - For Extension & Browser

**Source**: Use `Offlyn_Apply_Monogram.png`

**Required Sizes**:
```
Brandkit/exports/icon-48.png       (48 x 48 pixels)
Brandkit/exports/icon-96.png       (96 x 96 pixels)
Brandkit/exports/icon-128.png      (128 x 128 pixels)
Brandkit/exports/icon-256.png      (256 x 256 pixels) - optional, for high-DPI
```

**Specifications**:
- Format: PNG
- Background: Transparent
- Style: Clean, readable at small sizes
- Content: OA monogram centered and well-padded

**Usage**:
- Browser toolbar icon
- Extension popup header (small)
- Minimized in-page panel cube
- Tab icons

---

### 2. FULL LOGO - For Headers & Onboarding

**Source**: Use `Offlyn_Apply_Primary_Logo.png`

**Required Sizes**:
```
Brandkit/exports/logo-full-400w.png    (400 x 200 pixels or ~2:1 ratio)
Brandkit/exports/logo-full-600w.png    (600 x 300 pixels) - for high-DPI
Brandkit/exports/logo-full.svg         (Vector - if you have it)
```

**Specifications**:
- Format: PNG (and SVG if possible)
- Background: Transparent
- Aspect Ratio: Approximately 2:1 (width:height)
- Content: Full "Offlyn Apply" text + robot

**Usage**:
- Onboarding page header
- Dashboard header (optional)
- Marketing materials
- README/documentation

---

### 3. FAVICON - For Web Pages

**Source**: Use `Offlyn_Apply_Monogram.png`

**Required Sizes**:
```
Brandkit/exports/favicon.ico           (Multi-size ICO: 16x16, 32x32, 48x48)
Brandkit/exports/favicon-16x16.png     (16 x 16 pixels)
Brandkit/exports/favicon-32x32.png     (32 x 32 pixels)
```

**Specifications**:
- Format: ICO (multi-resolution) or PNG
- Background: Transparent or solid color
- Content: OA monogram (simplified for 16x16)

**Usage**:
- Dashboard page tab icon
- Onboarding page tab icon

---

### 4. CUBE LOGO - For Minimized In-Page Panel

**Source**: Use `Offlyn_Apply_Monogram.png`

**Required Sizes**:
```
Brandkit/exports/cube-64.png           (64 x 64 pixels)
Brandkit/exports/cube-48.png           (48 x 48 pixels)
```

**Specifications**:
- Format: PNG
- Background: Can have subtle shadow or glow for depth
- Style: Should look good on any webpage background
- Content: OA monogram, slightly stylized for 3D effect (optional)

**Usage**:
- Minimized field summary panel (floating cube on job sites)

---

### 5. HEADER ICONS - For Popup & Panels

**Source**: Use `Offlyn_Apply_Monogram.png`

**Required Sizes**:
```
Brandkit/exports/header-icon-24.png    (24 x 24 pixels)
Brandkit/exports/header-icon-32.png    (32 x 32 pixels)
```

**Specifications**:
- Format: PNG
- Background: Transparent
- Content: OA monogram, clean and simple

**Usage**:
- Popup header
- Field summary panel header
- Cover letter panel header

---

## Summary of Files You Need to Export

From Brandkit folder, export these to `Brandkit/exports/`:

### Priority 1 (REQUIRED)
- [ ] `icon-48.png` (48x48)
- [ ] `icon-96.png` (96x96)
- [ ] `icon-128.png` (128x128)
- [ ] `logo-full-400w.png` (400x200)
- [ ] `favicon.ico` (16, 32, 48 multi-size)

### Priority 2 (RECOMMENDED)
- [ ] `icon-256.png` (256x256)
- [ ] `logo-full-600w.png` (600x300)
- [ ] `cube-64.png` (64x64)
- [ ] `header-icon-24.png` (24x24)
- [ ] `header-icon-32.png` (32x32)

### Priority 3 (OPTIONAL)
- [ ] `logo-full.svg` (vector format)
- [ ] `favicon-16x16.png` (16x16)
- [ ] `favicon-32x32.png` (32x32)

**Total Files Needed**: 10-13 image files

---

## Export Guidelines

### For Monogram Icons (48, 96, 128, 256)
1. Start with `Offlyn_Apply_Monogram.png`
2. Resize to exact dimensions (maintain aspect ratio, add padding if needed)
3. Ensure OA letters are centered
4. Keep plenty of padding around edges (at least 10% on all sides)
5. Export as PNG with transparency
6. Test: Should be readable at 48x48 on both light and dark backgrounds

### For Full Logo (400w, 600w)
1. Start with `Offlyn_Apply_Primary_Logo.png`
2. Resize maintaining aspect ratio
3. Export as PNG with transparency
4. Ensure text is crisp and readable
5. Robot details should be clear

### For Favicon
1. Create multi-size ICO file with sizes: 16x16, 32x32, 48x48
2. At 16x16, simplify the OA if needed (might need manual adjustment)
3. Tools:
   - Online: https://www.favicon-generator.org/
   - Mac: Use Photoshop/Sketch/Figma export
   - Command line: `convert icon-48.png -define icon:auto-resize=48,32,16 favicon.ico`

### For Cube/Header Icons
1. Start with monogram
2. Resize to exact dimensions
3. For cube: Consider adding subtle shadow/glow
4. Export as PNG with transparency

---

## File Organization

```
Brandkit/
├── Offlyn_Apply_Monogram.png        (Your source file)
├── Offlyn_Apply_Primary_Logo.png    (Your source file)
├── offlyn-logo-3d.png                (Your source file)
└── exports/                          (Create this folder)
    ├── icon-48.png
    ├── icon-96.png
    ├── icon-128.png
    ├── icon-256.png
    ├── logo-full-400w.png
    ├── logo-full-600w.png
    ├── logo-full.svg (if available)
    ├── favicon.ico
    ├── favicon-16x16.png
    ├── favicon-32x32.png
    ├── cube-64.png
    ├── cube-48.png
    ├── header-icon-24.png
    └── header-icon-32.png
```

---

## Quick Export Checklist

Use your design tool (Photoshop, Figma, Illustrator, etc.):

**Monogram Exports**:
- [ ] Export at 48x48 → `icon-48.png`
- [ ] Export at 96x96 → `icon-96.png`
- [ ] Export at 128x128 → `icon-128.png`
- [ ] Export at 256x256 → `icon-256.png`

**Full Logo Exports**:
- [ ] Export at 400px wide → `logo-full-400w.png`
- [ ] Export at 600px wide → `logo-full-600w.png`

**Small Icons**:
- [ ] Export at 24x24 → `header-icon-24.png`
- [ ] Export at 32x32 → `header-icon-32.png`
- [ ] Export at 64x64 → `cube-64.png`

**Favicon**:
- [ ] Create multi-size ICO → `favicon.ico`

---

## After Export

Once you've created all the files in `Brandkit/exports/`, let me know and I'll:

1. Copy them to the correct locations in the extension
2. Update all the HTML/CSS/TS files
3. Test them in all contexts

The mapping will be:
```
Brandkit/exports/icon-*.png         → apps/extension-firefox/public/icons/
Brandkit/exports/logo-full-*.png    → apps/extension-firefox/public/icons/
Brandkit/exports/favicon.ico        → apps/extension-firefox/public/icons/
Brandkit/exports/cube-*.png         → apps/extension-firefox/public/icons/
Brandkit/exports/header-icon-*.png  → apps/extension-firefox/public/icons/
```

---

## Need Help?

If you need help with export dimensions or tools:
- **ImageMagick**: Command-line batch resizing
- **Figma**: Export with multiple sizes at once
- **Online Tools**: favicon-generator.org, resizeimage.net

Let me know when you've exported the files!
