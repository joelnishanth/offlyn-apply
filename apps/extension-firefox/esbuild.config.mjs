import * as esbuild from 'esbuild';
import { readdirSync, statSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const watch = process.argv.includes('--watch');

// Copy public files to dist
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

// Build configuration
const buildOptions = {
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  sourcemap: watch,
  minify: !watch,
  define: {
    'process.env.NODE_ENV': watch ? '"development"' : '"production"',
  },
};

// Build options for the React Data Explorer — needs JSX + larger chunk budget
const dataExplorerOptions = {
  ...buildOptions,
  jsx: 'automatic',
};

// Custom output paths
const pathMap = {
  'src/background.ts': 'dist/background.js',
  'src/content.ts': 'dist/content.js',
  'src/popup/popup.ts': 'dist/popup/popup.js',
  'src/onboarding/onboarding.ts': 'dist/onboarding/onboarding.js',
  'src/dashboard/dashboard.ts': 'dist/dashboard/dashboard.js',
  'src/settings/settings.ts': 'dist/settings/settings.js',
  'src/chat/chat.ts': 'dist/chat/chat.js',
};

async function build() {
  try {
    // Copy public files first
    copyPublicFiles();
    
    // Build each entry point separately to control output paths
    for (const [entry, outfile] of Object.entries(pathMap)) {
      await esbuild.build({
        ...buildOptions,
        entryPoints: [entry],
        outfile,
      });
    }

    // Build the React Data Explorer separately with JSX support
    await esbuild.build({
      ...dataExplorerOptions,
      entryPoints: ['src/data/data.tsx'],
      outfile: 'dist/data/data.js',
    });
    
    console.log('Build complete!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

if (watch) {
  // For watch mode, build all entry points with context
  async function watchBuild() {
    copyPublicFiles();
    
    const contexts = [];
    for (const [entry, outfile] of Object.entries(pathMap)) {
      const ctx = await esbuild.context({
        ...buildOptions,
        entryPoints: [entry],
        outfile,
      });
      contexts.push(ctx);
    }
    
    // Add Data Explorer with JSX support
    const dataCtx = await esbuild.context({
      ...dataExplorerOptions,
      entryPoints: ['src/data/data.tsx'],
      outfile: 'dist/data/data.js',
    });
    contexts.push(dataCtx);

    // Watch all contexts
    await Promise.all(contexts.map(ctx => ctx.watch()));
    console.log('Watching for changes...');
  }
  
  watchBuild().catch(err => {
    console.error('Watch setup failed:', err);
    process.exit(1);
  });
} else {
  build();
}
