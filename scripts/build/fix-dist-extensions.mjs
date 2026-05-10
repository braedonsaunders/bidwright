#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const distDir = resolve(process.argv[2] ?? "dist");

if (!existsSync(distDir)) {
  console.error(`fix-dist-extensions: ${distDir} does not exist`);
  process.exit(1);
}

const SKIP_EXT = /\.(js|jsx|mjs|cjs|json|css|svg|png|jpg|jpeg|gif|woff|woff2|ttf|otf|html|md|node|wasm)$/;

function findJsFiles(dir, results = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) findJsFiles(full, results);
    else if (name.endsWith(".js") || name.endsWith(".mjs")) results.push(full);
  }
  return results;
}

function resolveImport(fromDir, spec) {
  if (existsSync(join(fromDir, `${spec}.js`))) return `${spec}.js`;
  if (existsSync(join(fromDir, spec, "index.js"))) return `${spec}/index.js`;
  return null;
}

let totalFixed = 0;
let totalChanges = 0;

for (const file of findJsFiles(distDir)) {
  let src = readFileSync(file, "utf8");
  const dir = dirname(file);
  let changes = 0;

  src = src.replace(
    /((?:^|[\s;{(])(?:import|export)(?:[^"';]*?from\s*)?\s*)(["'])(\.[^"']+)\2/gm,
    (match, prefix, quote, spec) => {
      if (SKIP_EXT.test(spec)) return match;
      const fixed = resolveImport(dir, spec);
      if (!fixed) return match;
      changes++;
      return `${prefix}${quote}${fixed}${quote}`;
    },
  );

  src = src.replace(
    /(\bimport\s*\(\s*)(["'])(\.[^"']+)\2/g,
    (match, prefix, quote, spec) => {
      if (SKIP_EXT.test(spec)) return match;
      const fixed = resolveImport(dir, spec);
      if (!fixed) return match;
      changes++;
      return `${prefix}${quote}${fixed}${quote}`;
    },
  );

  if (changes > 0) {
    writeFileSync(file, src);
    totalFixed++;
    totalChanges += changes;
  }
}

if (totalChanges > 0) {
  console.log(`fix-dist-extensions: ${totalFixed} files, ${totalChanges} imports rewritten in ${distDir}`);
}
