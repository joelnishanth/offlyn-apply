# Quick Export List - Offlyn Apply

## Your Source Files
- `Offlyn_Apply_Monogram.png` (340x280) - OA monogram
- `Offlyn_Apply_Primary_Logo.png` (658x368) - Full logo with robot
- `offlyn-logo-3d.png` (886x1266) - 3D version

---

## What You Need to Export

Create a folder: `Brandkit/exports/` and export these files:

### MUST HAVE (Do these first)

**From Monogram** (`Offlyn_Apply_Monogram.png`):
```
✓ icon-48.png          → 48 x 48 pixels
✓ icon-96.png          → 96 x 96 pixels  
✓ icon-128.png         → 128 x 128 pixels
```

**From Full Logo** (`Offlyn_Apply_Primary_Logo.png`):
```
✓ logo-full-400w.png   → 400 pixels wide (maintain ratio)
```

**Favicon** (from Monogram):
```
✓ favicon.ico          → Multi-size: 16x16, 32x32, 48x48
```

### RECOMMENDED (Do these if you have time)

**From Monogram**:
```
✓ icon-256.png         → 256 x 256 pixels (high-DPI displays)
✓ header-icon-24.png   → 24 x 24 pixels (panel headers)
✓ header-icon-32.png   → 32 x 32 pixels (panel headers)
✓ cube-64.png          → 64 x 64 pixels (minimized floating panel)
```

**From Full Logo**:
```
✓ logo-full-600w.png   → 600 pixels wide (high-DPI)
```

---

## Export Settings

### For All PNG Files:
- **Format**: PNG
- **Background**: Transparent
- **Color Mode**: RGB/RGBA
- **Quality**: Maximum (no compression)

### For Icons (48, 96, 128, 256):
- Start with `Offlyn_Apply_Monogram.png`
- Resize to EXACT square dimensions
- Keep padding: minimum 10% on all sides
- Center the OA letters
- Make sure it's readable at small sizes

### For Full Logo (400w, 600w):
- Start with `Offlyn_Apply_Primary_Logo.png`
- Resize to specified width
- Maintain aspect ratio (height auto)
- Keep all details crisp

### For Favicon.ico:
- Use a tool like:
  - Online: https://www.favicon-generator.org/
  - Mac: https://iconverticons.com/online/
  - Command line: `convert icon-48.png -define icon:auto-resize=48,32,16 favicon.ico`

---

## Quick Export Steps (Using Your Design Tool)

### Option 1: Photoshop
1. Open `Offlyn_Apply_Monogram.png`
2. Image → Image Size
3. Set width/height (keep constrain proportions ON)
4. Add canvas padding if needed (Image → Canvas Size)
5. File → Export → Export As → PNG
6. Repeat for each size

### Option 2: Figma
1. Import your PNG
2. Select the layer
3. In Export panel, add multiple export settings:
   - 48w, 96w, 128w, 256w
4. Export all at once

### Option 3: Online Tool
1. Upload to https://www.iloveimg.com/resize-image
2. Resize to exact dimensions
3. Download each size

### Option 4: Command Line (Mac/Linux)
```bash
cd Brandkit
mkdir -p exports

# Monogram to icons
sips -z 48 48 Offlyn_Apply_Monogram.png --out exports/icon-48.png
sips -z 96 96 Offlyn_Apply_Monogram.png --out exports/icon-96.png
sips -z 128 128 Offlyn_Apply_Monogram.png --out exports/icon-128.png
sips -z 256 256 Offlyn_Apply_Monogram.png --out exports/icon-256.png

# Headers
sips -z 24 24 Offlyn_Apply_Monogram.png --out exports/header-icon-24.png
sips -z 32 32 Offlyn_Apply_Monogram.png --out exports/header-icon-32.png
sips -z 64 64 Offlyn_Apply_Monogram.png --out exports/cube-64.png

# Full logo
sips -Z 400 Offlyn_Apply_Primary_Logo.png --out exports/logo-full-400w.png
sips -Z 600 Offlyn_Apply_Primary_Logo.png --out exports/logo-full-600w.png
```

---

## Checklist

### Priority 1 (Required for Extension to Work)
- [ ] `icon-48.png` ← Browser toolbar icon
- [ ] `icon-96.png` ← Browser toolbar icon @2x
- [ ] `icon-128.png` ← Extension store
- [ ] `logo-full-400w.png` ← Onboarding header
- [ ] `favicon.ico` ← Tab icon

### Priority 2 (Recommended)
- [ ] `icon-256.png`
- [ ] `logo-full-600w.png`
- [ ] `header-icon-24.png`
- [ ] `header-icon-32.png`
- [ ] `cube-64.png`

---

## After Export

Once done, your folder should look like:

```
Brandkit/
├── Offlyn_Apply_Monogram.png
├── Offlyn_Apply_Primary_Logo.png
├── offlyn-logo-3d.png
└── exports/
    ├── icon-48.png ✓
    ├── icon-96.png ✓
    ├── icon-128.png ✓
    ├── icon-256.png ✓
    ├── logo-full-400w.png ✓
    ├── logo-full-600w.png ✓
    ├── favicon.ico ✓
    ├── header-icon-24.png ✓
    ├── header-icon-32.png ✓
    └── cube-64.png ✓
```

**Then**: Let me know and I'll copy them to the extension and update all the code!

---

## Need Help?

Stuck on export? Just export the **Priority 1 files** (first 5) and we can generate the rest programmatically.

Minimum needed:
1. `icon-48.png`
2. `icon-96.png`
3. `icon-128.png`
4. `logo-full-400w.png`
5. `favicon.ico`

With these 5, the extension will work and we can create the others as needed.
