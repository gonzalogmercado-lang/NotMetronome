#!/usr/bin/env node
/**
 * NotMetronome — Contradiction Gate (Windows-safe)
 *
 * Goal: Contradictions = 0 before merge
 * Buckets:
 *  - Architecture (banned imports / deprecated paths)
 *  - Typecheck (tsc --noEmit)
 *  - Tests (npm test) if present
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const ROOT = process.cwd();

function log(msg = "") {
  process.stdout.write(msg + "\n");
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function walk(dir, exts, out = []) {
  if (!exists(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist" || e.name === "build") continue;
      walk(full, exts, out);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (exts.has(ext)) out.push(full);
    }
  }
  return out;
}

function getPackageJson() {
  const p = path.join(ROOT, "package.json");
  if (!exists(p)) return null;
  return readJson(p);
}

function hasScript(pkg, name) {
  return Boolean(pkg?.scripts && typeof pkg.scripts[name] === "string" && pkg.scripts[name].trim().length > 0);
}

/**
 * Run a command line via the user's shell.
 * This is critical on Windows so npm/npx resolve correctly (.cmd/.ps1).
 */
function runCmd(title, commandLine) {
  log(`\n== ${title} ==`);
  log(`$ ${commandLine}`);

  const res = spawnSync(commandLine, {
    cwd: ROOT,
    stdio: "inherit",
    shell: true, // ✅ Windows-safe
    env: { ...process.env, CI: "1" },
  });

  const code = typeof res.status === "number" ? res.status : 1;

  if (res.error) {
    log(`⚠️ spawn error: ${res.error.message}`);
  }

  log(`exit code: ${code}`);
  return { ok: code === 0, code, error: res.error };
}

function scanArchitectureRules() {
  const violations = [];

  // Keep rules small + strict. Add more as project hardens.
  const rules = [
    {
      id: "NO_LEGACY_IMPORTS",
      severity: "P1",
      description: "No imports desde src/_legacy (debe estar en cuarentena).",
      regex: /(from\s+['"][^'"]*\/_legacy\/[^'"]*['"])|(require\(\s*['"][^'"]*\/_legacy\/[^'"]*['"]\s*\))/g,
      include: ["src"],
    },
    {
      id: "NO_DEPRECATED_PRESETS_PATH",
      severity: "P1",
      description: "No imports desde paths deprecated de presets (core/constants/clave*).",
      regex: /(from\s+['"][^'"]*core\/constants\/clave(Config|Presets)[^'"]*['"])|(from\s+['"][^'"]*core\/constants\/clave[^'"]*['"])/g,
      include: ["src"],
    },
    {
      id: "NO_ACCENTLEVEL_STRINGS_BAR_GROUP_WEAK",
      severity: "P2",
      description:
        "Evitar strings sueltas de acentos antiguos ('BAR'/'GROUP'/'WEAK'). Usar el contrato canónico (BAR_STRONG/GROUP_MED/SUBDIV_WEAK).",
      regex: /(['"`])(BAR|GROUP|WEAK)\1/g,
      include: ["src"],
    },
  ];

  const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

  for (const rule of rules) {
    for (const folder of rule.include) {
      const dir = path.join(ROOT, folder);
      const files = walk(dir, exts);
      for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        rule.regex.lastIndex = 0;
        let m;
        while ((m = rule.regex.exec(text))) {
          const idx = m.index;
          const before = text.slice(0, idx);
          const line = before.split("\n").length;
          const rel = path.relative(ROOT, file).replace(/\\/g, "/");
          violations.push({
            rule: rule.id,
            severity: rule.severity,
            file: rel,
            line,
            snippet: m[0].slice(0, 160),
            message: rule.description,
          });
        }
      }
    }
  }

  return violations;
}

function formatViolations(violations) {
  if (violations.length === 0) return "";
  const byRule = new Map();
  for (const v of violations) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, []);
    byRule.get(v.rule).push(v);
  }

  let out = "";
  for (const [rule, items] of byRule.entries()) {
    out += `\n- ${rule} (${items.length})\n`;
    for (const v of items.slice(0, 30)) {
      out += `  - ${v.file}:${v.line} :: ${v.snippet}\n`;
    }
    if (items.length > 30) out += `  ... +${items.length - 30} más\n`;
  }
  return out;
}

function main() {
  const pkg = getPackageJson();

  let contradictions = 0;
  const notes = [];

  log("NotMetronome — Contradiction Gate");
  log("---------------------------------");

  // 1) Architecture checks
  log("\n== Architecture checks ==");
  const violations = scanArchitectureRules();
  if (violations.length > 0) {
    contradictions += 1;
    notes.push({ title: "Architecture contradictions", details: formatViolations(violations) });
    log("❌ Violaciones encontradas.");
  } else {
    log("✅ Sin violaciones arquitectónicas (reglas actuales).");
  }

  // 2) Typecheck
  const typecheck = runCmd("Typecheck (tsc --noEmit)", "npx tsc -p tsconfig.json --noEmit");
  if (!typecheck.ok) {
    contradictions += 1;
    notes.push({
      title: "Typecheck failed",
      details: "\nTypeScript encontró errores (o no pudo ejecutarse). Mirá el output arriba.\n",
    });
  }

  // 3) Tests (only if present)
  if (pkg && hasScript(pkg, "test")) {
    const tests = runCmd("Tests (npm test)", "npm test");
    if (!tests.ok) {
      contradictions += 1;
      notes.push({ title: "Tests failed", details: "\nLos tests fallaron. Mirá el output arriba.\n" });
    }
  } else {
    log("\n== Tests ==");
    log("⚠️  No hay script 'test' en package.json. (No suma contradicción; pero es deuda).");
  }

  // Summary
  log("\n---------------------------------");
  log(`Contradictions score: ${contradictions}`);

  if (contradictions === 0) {
    log("✅ Gate PASSED.");
    process.exit(0);
  }

  log("❌ Gate FAILED. Lista de problemas:");
  for (const n of notes) {
    log(`\n### ${n.title}`);
    log(n.details.trimEnd());
  }
  process.exit(1);
}

main();
