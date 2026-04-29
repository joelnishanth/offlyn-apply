# Offlyn Apply - Export Table

## Simple Export Guide

| File Name | Size | Source | Priority | Used For |
|-----------|------|--------|----------|----------|
| `icon-48.png` | 48x48 | Monogram | 🔴 MUST | Browser toolbar, extension icon |
| `icon-96.png` | 96x96 | Monogram | 🔴 MUST | Browser toolbar @2x, popup |
| `icon-128.png` | 128x128 | Monogram | 🔴 MUST | Extension store, Chrome Web Store |
| `logo-full-400w.png` | 400px wide | Full Logo | 🔴 MUST | Onboarding page header |
| `favicon.ico` | 16+32+48 | Monogram | 🔴 MUST | Dashboard/Onboarding tab icon |
| `icon-256.png` | 256x256 | Monogram | 🟡 Recommend | High-DPI displays, marketing |
| `logo-full-600w.png` | 600px wide | Full Logo | 🟡 Recommend | High-DPI displays |
| `header-icon-24.png` | 24x24 | Monogram | 🟡 Recommend | Panel headers (small) |
| `header-icon-32.png` | 32x32 | Monogram | 🟡 Recommend | Panel headers (medium) |
| `cube-64.png` | 64x64 | Monogram | 🟡 Recommend | Minimized floating panel |

**Total**: 5 required + 5 recommended = 10 files

---

## Command Line Quick Export (Mac/Linux)

If you have ImageMagick or sips:

```bash
cd Brandkit
mkdir -p exports

# Required files
sips -z 48 48 Offlyn_Apply_Monogram.png --out exports/icon-48.png
sips -z 96 96 Offlyn_Apply_Monogram.png --out exports/icon-96.png
sips -z 128 128 Offlyn_Apply_Monogram.png --out exports/icon-128.png
sips -Z 400 Offlyn_Apply_Primary_Logo.png --out exports/logo-full-400w.png

# Recommended files
sips -z 256 256 Offlyn_Apply_Monogram.png --out exports/icon-256.png
sips -Z 600 Offlyn_Apply_Primary_Logo.png --out exports/logo-full-600w.png
sips -z 24 24 Offlyn_Apply_Monogram.png --out exports/header-icon-24.png
sips -z 32 32 Offlyn_Apply_Monogram.png --out exports/header-icon-32.png
sips -z 64 64 Offlyn_Apply_Monogram.png --out exports/cube-64.png

# For favicon, use online tool or:
convert exports/icon-48.png -define icon:auto-resize=48,32,16 exports/favicon.ico
```

---

## Online Export (No Design Tools Needed)

### Step 1: Resize Images
1. Go to: https://www.iloveimg.com/resize-image
2. Upload `Offlyn_Apply_Monogram.png`
3. Choose "By Pixels"
4. Enter dimensions (48x48, 96x96, etc.)
5. Download
6. Repeat for each size

### Step 2: Create Favicon
1. Go to: https://www.favicon-generator.org/
2. Upload `icon-48.png` (after creating it in Step 1)
3. Download `favicon.ico`

---

## What I'll Do After You Export

Once you place files in `Brandkit/exports/`, I'll:

1. Copy to `apps/extension-firefox/public/icons/`
2. Update manifest.json
3. Update popup.html
4. Update dashboard.html
5. Update onboarding.html
6. Update all UI component files
7. Test in browser

**Time needed**: 30-60 minutes for you to export, 2-3 hours for me to integrate

---

## Minimum Viable Export

If you're in a hurry, just create these 3:

1. `icon-128.png` (128x128)
2. `logo-full-400w.png` (400px wide)
3. `favicon.ico` (multi-size)

I can programmatically generate the rest from these!
