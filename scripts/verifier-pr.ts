#!/usr/bin/env node
// Vérifie que le script pr-a-fusionner.sh fonctionne correctement.
//
// À partir d'un projet test et d'une vraie API GitHub (publique).
//   SUPABASE_SERVICE_ROLE_KEY=… node --experimental-strip-types scripts/verifier-pr.ts

import { execSync } from "node:child_process";

// Stub tests : juste vérifier que le script :
// 1. Accepte les bons arguments
// 2. Retourne un code de sortie valide

const tests = [
  {
    name: "Usage sans argument",
    cmd: ["bash", "scripts/pr-a-fusionner.sh"],
    expectError: true,
  },
  {
    name: "Usage avec -h",
    cmd: ["bash", "scripts/pr-a-fusionner.sh", "-h"],
    expectError: false,
  },
  {
    name: "Syntaxe : number non-valide",
    cmd: ["bash", "scripts/pr-a-fusionner.sh", "abc"],
    expectError: true,
  },
];

console.log("Vérification du script pr-a-fusionner.sh…");

for (const test of tests) {
  try {
    const result = execSync(test.cmd.join(" "), {
      cwd: process.cwd(),
      stdio: "pipe",
      encoding: "utf-8",
    });
    if (test.expectError) {
      console.error(`✗ ${test.name} : devrait échouer mais a réussi`);
      process.exit(1);
    } else {
      console.log(`✓ ${test.name}`);
    }
  } catch (e) {
    if (!test.expectError) {
      console.error(`✗ ${test.name} : devrait réussir mais a échoué`);
      console.error((e as Error).message);
      process.exit(1);
    } else {
      console.log(`✓ ${test.name}`);
    }
  }
}

console.log("\nTests syntaxe : OK");
