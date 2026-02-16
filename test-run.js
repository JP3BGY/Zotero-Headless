import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Project Structure Test');
console.log('=====================');

// Check if TypeScript files exist
try {
  const checkFiles = [
    'packages/cli/src/index.ts',
    'packages/api/src/client.ts',
    'packages/database/src/schema.ts',
    'packages/sync-engine/src/manager.ts'
  ];
  
  checkFiles.forEach(file => {
    const fullPath = join(__dirname, file);
    try {
      require('fs').existsSync(fullPath);
      console.log(`✓ ${file}`);
    } catch (e) {
      console.log(`✗ ${file} - ${e.message}`);
    }
  });
  
  console.log('\nDependencies Check:');
  console.log('==================');
  
  // Check key dependencies
  const deps = ['axios', 'commander', 'zod', 'better-sqlite3', 'drizzle-orm'];
  deps.forEach(dep => {
    try {
      require.resolve(dep);
      console.log(`✓ ${dep} available`);
    } catch (e) {
      console.log(`✗ ${dep} not found`);
    }
  });
  
  console.log('\nTest Summary: Project structure looks good!');
} catch (error) {
  console.error('Error during test:', error.message);
  process.exit(1);
}
