import * as esbuild from 'esbuild';
import { readdirSync, statSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const watch = process.argv.includes('--watch');

function copyPublicFiles() {
  const publicDir = join(__dirname, 'public');
  const distDir = join(__dirname, 'dist');
  
  function copyRecursive(src, dest) {
    if (!existsSync(dest)) {
      mkdirSync(dest, { recursive: true });
    }
    
    const entries = readdirSync(src);
    for (const entry of entries) {
      const srcPath = join(src, entry);
      const destPath = join(dest, entry);
      const stat = statSync(srcPath);
      
      if (stat.isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else {
        copyFileSync(srcPath, destPath);
      }
    }
  }
  
  copyRecursive(publicDir, distDir);
}

const buildOptions = {
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  sourcemap: watch,
  minify: !watch,
  define: {
    'process.env.NODE_ENV': watch ? '"development"' : '"production"',
    'process.env.BROWSER': '"chrome"',
  },
};

// Options for JSX entry points (Data Explorer React app)
const jsxBuildOptions = {
  ...buildOptions,
  jsx: 'automatic',
};

const pathMap = {
  'src/background.ts': 'dist/background.js',
  'src/content.ts': 'dist/content.js',
  'src/popup/popup.ts': 'dist/popup/popup.js',
  'src/onboarding/onboarding.ts': 'dist/onboarding/onboarding.js',
  'src/dashboard/dashboard.ts': 'dist/dashboard/dashboard.js',
  'src/settings/settings.ts': 'dist/settings/settings.js',
  'src/chat/chat.ts': 'dist/chat/chat.js',
};

// Entry points that require JSX (React) compilation
const jsxPathMap = {
  'src/data/data.tsx': 'dist/data/data.js',
};

async function build() {
  try {
    copyPublicFiles();

    for (const [entry, outfile] of Object.entries(pathMap)) {
      await esbuild.build({ ...buildOptions, entryPoints: [entry], outfile });
    }

    for (const [entry, outfile] of Object.entries(jsxPathMap)) {
      await esbuild.build({ ...jsxBuildOptions, entryPoints: [entry], outfile });
    }

    console.log('Chrome extension build complete!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

if (watch) {
  async function watchBuild() {
    copyPublicFiles();

    const contexts = [];
    for (const [entry, outfile] of Object.entries(pathMap)) {
      const ctx = await esbuild.context({ ...buildOptions, entryPoints: [entry], outfile });
      contexts.push(ctx);
    }
    for (const [entry, outfile] of Object.entries(jsxPathMap)) {
      const ctx = await esbuild.context({ ...jsxBuildOptions, entryPoints: [entry], outfile });
      contexts.push(ctx);
    }

    await Promise.all(contexts.map(ctx => ctx.watch()));
    console.log('Watching Chrome extension for changes...');
  }

  watchBuild().catch(err => {
    console.error('Watch setup failed:', err);
    process.exit(1);
  });
} else {
  build();
}
