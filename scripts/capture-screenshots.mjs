import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const PUBLIC = join(REPO, 'apps/extension-chrome/public');
const OUT = join(REPO, '.screenshots/extension-pages');
mkdirSync(OUT, { recursive: true });

function toFile(...parts) {
  return pathToFileURL(join(PUBLIC, ...parts)).href;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

  const pages = [
    ['settings', 'settings/settings.html'],
    ['help', 'help/help.html'],
    ['privacy', 'privacy/privacy.html'],
    ['profiles', 'profiles/profiles.html'],
    ['jobs', 'jobs/jobs.html'],
    ['job-detected', 'job-detected/job-detected.html'],
  ];

  for (const [name, path] of pages) {
    const page = await ctx.newPage();
    try {
      await page.addInitScript(() => { try { localStorage.setItem('ofl-dark-mode', 'light'); } catch {} });
      await page.goto(toFile(path), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await delay(500);
      await page.screenshot({ path: join(OUT, name + '-light.png'), fullPage: true });

      const toggle = page.locator('#dark-mode-toggle');
      if (await toggle.count()) {
        await toggle.click();
        await delay(300);
        await page.screenshot({ path: join(OUT, name + '-dark.png'), fullPage: true });
      }
      console.log('OK:', name);
    } catch (e) {
      console.error('FAIL:', name, e.message);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log('Screenshots saved to:', OUT);
}

main().catch(console.error);
