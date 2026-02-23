#!/usr/bin/env node
// Script to replace process.exit(1) with throw new Error() in CLI commands
// This prevents the shell from exiting when a command fails

import { readFileSync, writeFileSync } from 'fs';

const filePath = 'apps/cli/src/index.ts';
const content = readFileSync(filePath, 'utf-8');

// Replace patterns that exit with process.exit(1)
// We need to be careful to only replace within execute functions

const lines = content.split('\n');
const newLines = [];
let inExecuteFunction = false;
let braceDepth = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Track if we're inside an execute function
  if (line.includes('execute:')) {
    inExecuteFunction = true;
    braceDepth = 0;
  }
  
  // Track brace depth
  if (inExecuteFunction) {
    braceDepth += (line.match(/{/g) || []).length;
    braceDepth -= (line.match(/}/g) || []).length;
    
    // Check if we're exiting the execute function
    if (braceDepth <= 0 && line.includes('},')) {
      inExecuteFunction = false;
    }
  }
  
  // Replace process.exit(1) with throw new Error
  if (inExecuteFunction && line.includes('process.exit(1)')) {
    // Check if there's a preceding console.log with error message
    let errorMsg = 'Command failed';
    
    // Look backwards for error message
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const prevLine = lines[j];
      const match = prevLine.match(/console\.log\(`\s*❌\s*([^`]+)`\)/);
      if (match) {
        errorMsg = match[1].trim();
        break;
      }
      const match2 = prevLine.match(/console\.log\(`\s*Error:\s*([^`]+)`\)/);
      if (match2) {
        errorMsg = match2[1].trim();
        break;
      }
    }
    
    // Replace the line
    newLines.push(line.replace('process.exit(1)', `throw new Error('${errorMsg}')`));
    console.log(`Replaced line ${i + 1}: ${errorMsg}`);
  } else {
    newLines.push(line);
  }
}

writeFileSync(filePath, newLines.join('\n'));
console.log('Done!');
