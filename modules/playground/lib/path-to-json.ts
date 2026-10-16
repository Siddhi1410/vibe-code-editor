import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents a file in the template structure
 */
export interface TemplateFile {
  filename: string;
  fileExtension: string;
  content: string;
}

/**
 * Represents a folder in the template structure which can contain files and other folders
 */
export interface TemplateFolder {
  folderName: string;
  items: (TemplateFile | TemplateFolder)[];
}

/**
 * Type representing either a file or folder in the template structure
 */
export type TemplateItem = TemplateFile | TemplateFolder;

/**
 * Options for scanning template directories
 */
interface ScanOptions {
  /**
   * Files to ignore (exact filenames with extensions)
   */
  ignoreFiles?: string[];
  
  /**
   * Folders to ignore (exact folder names)
   */
  ignoreFolders?: string[];
  
  /**
   * File patterns to ignore (regex patterns)
   */
  ignorePatterns?: RegExp[];
  
  /**
   * Maximum size of file to include content (in bytes)
   * Files larger than this will have a placeholder message instead of content
   */
  maxFileSize?: number;
}

/**
 * Scans a template directory and returns a structured JSON representation
 * 
 * @param templatePath - Path to the template directory
 * @param options - Scanning options to customize behavior
 * @returns Promise resolving to the template structure as JSON
 */
export async function scanTemplateDirectory(
  templatePath: string,
  options: ScanOptions = {}
): Promise<TemplateFolder> {
  // Set default options
  const defaultOptions: ScanOptions = {
    ignoreFiles: [
      'package-lock.json',
      'yarn.lock',
      '.DS_Store',
      'thumbs.db',
      '.gitignore',
      '.npmrc',
      '.yarnrc',
      '.env',
      '.env.local',
      '.env.development',
      '.env.production'
    ],
    ignoreFolders: [
      'node_modules',
      '.git',
      '.vscode',
      '.idea',
      'dist',
      'build',
      'coverage'
    ],
    ignorePatterns: [
      /^\..+\.swp$/,  // Vim swap files
      /^\.#/,         // Emacs backup files
      /~$/            // Backup files
    ],
    maxFileSize: 1024 * 1024 // 1MB
  };
  
  // Merge provided options with defaults
  const mergedOptions: ScanOptions = {
    ignoreFiles: [...(defaultOptions.ignoreFiles || []), ...(options.ignoreFiles || [])],
    ignoreFolders: [...(defaultOptions.ignoreFolders || []), ...(options.ignoreFolders || [])],
    ignorePatterns: [...(defaultOptions.ignorePatterns || []), ...(options.ignorePatterns || [])],
    maxFileSize: options.maxFileSize !== undefined ? options.maxFileSize : defaultOptions.maxFileSize
  };

  // Validate the input path
  if (!templatePath) {
    throw new Error('Template path is required');
  }

  // Check if the template path exists
  try {
    const stats = await fs.promises.stat(templatePath);
    if (!stats.isDirectory()) {
      throw new Error(`'${templatePath}' is not a directory`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Template directory '${templatePath}' does not exist`);
    }
    throw error;
  }

  // Get the folder name from the path
  const folderName = path.basename(templatePath);

  // Process the directory and return the result
  return processDirectory(folderName, templatePath, mergedOptions);
}

/**
 * Process a directory and its contents recursively
 * 
 * @param folderName - Name of the current folder
 * @param folderPath - Path to the current folder
 * @param options - Scanning options
 * @returns Promise resolving to a TemplateFolder object
 */
async function processDirectory(
  folderName: string, 
  folderPath: string, 
  options: ScanOptions
): Promise<TemplateFolder> {
  try {
    // Read directory contents
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    const items: TemplateItem[] = [];

    // Process each entry in the directory
    for (const entry of entries) {
      const entryName = entry.name;
      const entryPath = path.join(folderPath, entryName);

      // Check if this entry should be skipped
      if (entry.isDirectory()) {
        // Skip ignored folders
        if (options.ignoreFolders?.includes(entryName)) {
          console.log(`Skipping ignored folder: ${entryPath}`);
          continue;
        }
        
        // If it's a directory, process it recursively
        const subFolder = await processDirectory(entryName, entryPath, options);
        items.push(subFolder);
      } else if (entry.isFile()) {
        // Skip ignored files
        if (options.ignoreFiles?.includes(entryName)) {
          console.log(`Skipping ignored file: ${entryPath}`);
          continue;
        }
        
        // Check against regex patterns
        const shouldSkip = options.ignorePatterns?.some(pattern => pattern.test(entryName));
        if (shouldSkip) {
          console.log(`Skipping file matching ignore pattern: ${entryPath}`);
          continue;
        }
        
        // If it's a file, get its details
        try {
          const stats = await fs.promises.stat(entryPath);
          const parsedPath = path.parse(entryName);
          let content: string;
          
          // Check file size before reading content
          if (options.maxFileSize && stats.size > options.maxFileSize) {
            content = `[File content not included: size (${stats.size} bytes) exceeds maximum allowed size (${options.maxFileSize} bytes)]`;
          } else {
            content = await fs.promises.readFile(entryPath, 'utf8');
          }
          
          items.push({
            filename: parsedPath.name,
            fileExtension: parsedPath.ext.replace(/^\./, ''), // Remove leading dot
            content
          });
        } catch (error) {
          console.error(`Error reading file ${entryPath}:`, error);
          // Still include the file but with an error message as content
          const parsedPath = path.parse(entryName);
          items.push({
            filename: parsedPath.name,
            fileExtension: parsedPath.ext.replace(/^\./, ''),
            content: `Error reading file: ${(error as Error).message}`
          });
        }
      }
      // Ignore other types of entries (symlinks, etc.)
    }

    // Return the folder with its items
    return {
      folderName,
      items
    };
  } catch (error) {
    throw new Error(`Error processing directory '${folderPath}': ${(error as Error).message}`);
  }
}

/**
 * Saves the template structure to a JSON file
 * 
 * @param templatePath - Path to the template directory
 * @param outputPath - Path where the JSON file should be saved
 * @param options - Scanning options
 * @returns Promise resolving when the file has been written
 */
export async function saveTemplateStructureToJson(
  templatePath: string, 
  outputPath: string,
  options?: ScanOptions
): Promise<void> {
  try {
    // Scan the template directory
    const templateStructure = await scanTemplateDirectory(templatePath, options);
    
    // Ensure the output directory exists
    const outputDir = path.dirname(outputPath);
    await fs.promises.mkdir(outputDir, { recursive: true });
    
    // Write the JSON file
    const data = await fs.promises.writeFile(
      outputPath, 
      JSON.stringify(templateStructure, null, 2),
      'utf8'
    );
    console.log(`Template structure saved to ${outputPath}`);


    
  } catch (error) {
    throw new Error(`Error saving template structure: ${(error as Error).message}`);
  }
}

export async function readTemplateStructureFromJson(filePath: string): Promise<TemplateFolder> {
  try {
    const data = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(data) as TemplateFolder;
  } catch (error) {
    throw new Error(`Error reading template structure: ${(error as Error).message}`);
  }
}

/**
 * Default template file structures for templates that may not have
 * physical directories on disk. These provide working starter projects
 * that can be used as fallbacks.
 */
export const defaultTemplateStructures: Record<string, TemplateFolder> = {
  NEXTJS: {
    folderName: "nextjs-new",
    items: [
      {
        filename: "package",
        fileExtension: "json",
        content: JSON.stringify(
          {
            name: "nextjs-starter",
            version: "0.1.0",
            private: true,
            scripts: {
              dev: "next dev",
              build: "next build",
              start: "next start",
              lint: "next lint",
            },
            dependencies: {
              next: "14.2.3",
              react: "^18.3.1",
              "react-dom": "^18.3.1",
            },
            devDependencies: {
              "@types/node": "^20",
              "@types/react": "^18",
              "@types/react-dom": "^18",
              typescript: "^5",
            },
          },
          null,
          2
        ),
      },
      {
        filename: "tsconfig",
        fileExtension: "json",
        content: JSON.stringify(
          {
            compilerOptions: {
              target: "ES2017",
              lib: ["dom", "dom.iterable", "esnext"],
              allowJs: true,
              skipLibCheck: true,
              strict: true,
              noEmit: true,
              esModuleInterop: true,
              module: "esnext",
              moduleResolution: "bundler",
              resolveJsonModule: true,
              isolatedModules: true,
              jsx: "preserve",
              incremental: true,
              paths: {
                "@/*": ["./*"],
              },
            },
            include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
            exclude: ["node_modules"],
          },
          null,
          2
        ),
      },
      {
        filename: "next.config",
        fileExtension: "mjs",
        content: `/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
`,
      },
      {
        folderName: "app",
        items: [
          {
            filename: "layout",
            fileExtension: "tsx",
            content: `import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Next.js App",
  description: "Created with Next.js",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
          },
          {
            filename: "page",
            fileExtension: "tsx",
            content: `export default function Home() {
  return (
    <main style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "sans-serif" }}>
      <h1>Welcome to Next.js!</h1>
      <p>Edit <code>app/page.tsx</code> to get started.</p>
    </main>
  );
}
`,
          },
          {
            filename: "globals",
            fileExtension: "css",
            content: `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background-color: #0a0a0a;
  color: #ededed;
}

a {
  color: inherit;
  text-decoration: none;
}
`,
          },
        ],
      },
      {
        folderName: "public",
        items: [
          {
            filename: "favicon",
            fileExtension: "ico",
            content: "",
          },
        ],
      },
    ],
  },

  VUE: {
    folderName: "vue",
    items: [
      {
        filename: "package",
        fileExtension: "json",
        content: JSON.stringify(
          {
            name: "vue-starter",
            version: "0.1.0",
            private: true,
            scripts: {
              dev: "vite",
              build: "vite build",
              preview: "vite preview",
            },
            dependencies: {
              vue: "^3.4.27",
            },
            devDependencies: {
              "@vitejs/plugin-vue": "^5.0.4",
              vite: "^5.2.11",
            },
          },
          null,
          2
        ),
      },
      {
        filename: "vite.config",
        fileExtension: "js",
        content: `import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
});
`,
      },
      {
        filename: "index",
        fileExtension: "html",
        content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vue App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`,
      },
      {
        folderName: "src",
        items: [
          {
            filename: "main",
            fileExtension: "js",
            content: `import { createApp } from "vue";
import App from "./App.vue";

createApp(App).mount("#app");
`,
          },
          {
            filename: "App",
            fileExtension: "vue",
            content: `<script setup>
import HelloWorld from "./components/HelloWorld.vue";
</script>

<template>
  <main style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; font-family: sans-serif">
    <HelloWorld msg="Welcome to Vue!" />
  </main>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background-color: #0a0a0a;
  color: #ededed;
}
</style>
`,
          },
          {
            folderName: "components",
            items: [
              {
                filename: "HelloWorld",
                fileExtension: "vue",
                content: `<script setup>
defineProps({
  msg: {
    type: String,
    required: true,
  },
});
</script>

<template>
  <div class="hello">
    <h1>{{ msg }}</h1>
    <p>Edit <code>src/App.vue</code> to get started.</p>
  </div>
</template>

<style scoped>
.hello {
  text-align: center;
}

h1 {
  font-size: 2.5rem;
  margin-bottom: 1rem;
}

code {
  background-color: #1a1a2e;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.9rem;
}
</style>
`,
              },
            ],
          },
        ],
      },
    ],
  },
};

/**
 * Returns the default template structure for a given template key.
 * Falls back to this when the physical starter directory doesn't exist.
 *
 * @param templateKey - The template key (e.g. "NEXTJS", "VUE")
 * @returns The default TemplateFolder structure, or null if no default exists
 */
export function getDefaultTemplateStructure(
  templateKey: string
): TemplateFolder | null {
  return defaultTemplateStructures[templateKey] || null;
}

/**
 * Example usage:
 * 
 * // Basic usage with default options
 * const templateStructure = await scanTemplateDirectory('./templates/react-app');
 * 
 * // With custom options
 * const customOptions = {
 *   ignoreFiles: ['README.md', 'CHANGELOG.md'],
 *   ignoreFolders: ['docs', 'examples'],
 *   maxFileSize: 500 * 1024 // 500KB
 * };
 * const templateStructure = await scanTemplateDirectory('./templates/react-app', customOptions);
 * 
 * // Saving directly to a JSON file with custom options
 * await saveTemplateStructureToJson(
 *   './templates/react-app', 
 *   './output/react-app-template.json',
 *   customOptions
 * );
 * 
 * // Using default template structures as fallback
 * const nextjsTemplate = getDefaultTemplateStructure("NEXTJS");
 * const vueTemplate = getDefaultTemplateStructure("VUE");
 */