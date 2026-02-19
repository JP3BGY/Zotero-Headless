#!/usr/bin/env node
// Test attachment manager functions

async function main() {
  console.log('Testing attachment manager functions...\n');

  // Import attachment manager instance
  const { attachmentManager } = await import('@zotero-headless/attachment-manager');

  // Test 1: List attachments
  console.log('1. Testing listAttachments...');
  try {
    const list = await attachmentManager.listAttachments({ limit: 10 });
    console.log(`   Found ${list.length} attachments\n`);
  } catch (e) {
    console.log(`   Error: ${e.message}\n`);
  }

  // Test 2: Find duplicates
  console.log('2. Testing findDuplicates...');
  try {
    const dups = await attachmentManager.findDuplicates();
    if (dups.success) {
      console.log(`   Found ${dups.duplicates.length} duplicate groups\n`);
    } else {
      console.log(`   Error: ${dups.error}\n`);
    }
  } catch (e) {
    console.log(`   Error: ${e.message}\n`);
  }

  console.log('Done!');
}

main().catch(console.error);
