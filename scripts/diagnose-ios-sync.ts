/**
 * Diagnose Zotero iOS sync issues (READ-ONLY, safe for any account)
 *
 * This script ONLY uses GET requests to the Zotero API.
 * It does NOT modify, create, or delete any data.
 *
 * Usage:
 *   npx tsx scripts/diagnose-ios-sync.ts --key YOUR_API_KEY --uid YOUR_USER_ID
 *   npx tsx scripts/diagnose-ios-sync.ts --key YOUR_API_KEY  # auto-resolves user ID
 *
 * Or via environment variables:
 *   ZOTERO_API_KEY=xxx ZOTERO_USER_ID=123 npx tsx scripts/diagnose-ios-sync.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://api.zotero.org';

// ============ Parse CLI args ============

function parseArgs(): { apiKey: string; userId?: string } {
  const args = process.argv.slice(2);
  let apiKey = process.env.ZOTERO_API_KEY || '';
  let userId = process.env.ZOTERO_USER_ID || '';

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--key' || args[i] === '-k') && args[i + 1]) {
      apiKey = args[++i];
    } else if ((args[i] === '--uid' || args[i] === '-u') && args[i + 1]) {
      userId = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Zotero iOS Sync Diagnostic Tool (READ-ONLY)

Usage:
  npx tsx scripts/diagnose-ios-sync.ts --key API_KEY [--uid USER_ID]

Options:
  --key, -k   Zotero API key (required)
  --uid, -u   Zotero user ID (numeric, auto-resolved if omitted)
  --help, -h  Show this help

This script only reads data via GET requests. It never modifies your library.
`);
      process.exit(0);
    }
  }

  if (!apiKey) {
    console.error('Error: API key is required. Use --key YOUR_API_KEY');
    process.exit(1);
  }

  return { apiKey, userId: userId || undefined };
}

// ============ Resolve user ID from API key ============

async function resolveUserId(apiKey: string, userId?: string): Promise<string> {
  if (userId && /^\d+$/.test(userId)) return userId;

  const res = await fetch(`${BASE_URL}/keys/current`, {
    headers: { 'Zotero-API-Key': apiKey, 'Zotero-API-Version': '3' },
  });
  if (!res.ok) throw new Error(`Cannot resolve user ID (HTTP ${res.status}). Check your API key.`);
  const info = (await res.json()) as { userID: number; username: string };
  console.error(`Resolved API key → user "${info.username}" (ID: ${info.userID})`);
  return String(info.userID);
}

// ============ Load iOS Schema ============

// Use the ACTUAL schema from Zotero iOS v1.0.40 (Build 281) — schema version 29
// NOT the latest HEAD which has schema v40
const schemaPath = path.resolve(__dirname, '../references/zotero-ios-v1.0.40-schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

interface FieldDef {
  field: string;
  baseField?: string;
}

interface ItemTypeDef {
  itemType: string;
  fields: FieldDef[];
  creatorTypes: Array<{ creatorType: string; primary?: boolean }>;
}

// Build lookup: itemType -> Set of valid field names
const schemaFieldsByType = new Map<string, Set<string>>();
const schemaBaseFieldsByType = new Map<string, Set<string>>();

for (const t of schema.itemTypes as ItemTypeDef[]) {
  schemaFieldsByType.set(t.itemType, new Set(t.fields.map((f: FieldDef) => f.field)));
  schemaBaseFieldsByType.set(
    t.itemType,
    new Set(t.fields.filter((f: FieldDef) => f.baseField).map((f: FieldDef) => f.baseField!))
  );
}

// iOS known non-field keys (from FieldKeys.swift:162)
const knownNonFieldKeys = new Set([
  'creators', 'itemType', 'version', 'key', 'tags', 'deleted',
  'collections', 'relations', 'dateAdded', 'dateModified',
  'parentItem', 'inPublications',
]);

// iOS attachment known keys (from FieldKeys.swift:49-51)
const attachmentKnownKeys = new Set([
  'title', 'contentType', 'md5', 'mtime', 'filename', 'linkMode', 'charset', 'path', 'url',
]);

// iOS annotation known keys (from FieldKeys.swift:79-81)
const annotationKnownKeys = new Set([
  'annotationColor', 'annotationComment', 'annotationPageLabel',
  'annotationPosition', 'annotationText', 'annotationType',
  'annotationSortIndex', 'annotationAuthorName',
]);

// ============ iOS isKnownField logic (mirrors ItemResponse.swift:456-473) ============

function isKnownField(field: string, itemType: string): boolean {
  if (field === 'note') return true;
  const schemaFields = schemaFieldsByType.get(itemType);
  if (schemaFields?.has(field)) return true;
  if (itemType === 'annotation') return annotationKnownKeys.has(field);
  if (itemType === 'attachment') return attachmentKnownKeys.has(field);
  return false;
}

// ============ API Fetching (GET only) ============

async function fetchAllItems(apiKey: string, numericUserId: string): Promise<any[]> {
  const allItems: any[] = [];
  let start = 0;
  const limit = 100;

  while (true) {
    const url = `${BASE_URL}/users/${numericUserId}/items?format=json&includeTrashed=1&limit=${limit}&start=${start}`;
    console.error(`  Fetching items ${start}–${start + limit}...`);

    const response = await fetch(url, {
      headers: { 'Zotero-API-Key': apiKey, 'Zotero-API-Version': '3' },
    });

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${await response.text()}`);
    }

    const items = (await response.json()) as any[];
    allItems.push(...items);

    const totalResults = Number(response.headers.get('Total-Results') || 0);
    console.error(`    Got ${items.length} (total in library: ${totalResults})`);

    if (allItems.length >= totalResults || items.length === 0) break;
    start += limit;
  }

  return allItems;
}

// ============ Diagnosis ============

interface Problem {
  itemKey: string;
  itemType: string;
  title: string;
  version: number;
  unknownFields: string[];
  details: string[];
}

function diagnoseItem(item: any): Problem | null {
  const data = item.data as Record<string, unknown>;
  const itemType = data.itemType as string;
  const key = (data.key as string) || item.key;
  const version = (data.version as number) || item.version || 0;
  const title = (data.title || data.caseName || data.nameOfAct || data.subject || '') as string;

  if (!schemaFieldsByType.has(itemType)) {
    return {
      itemKey: key, itemType, title, version, unknownFields: [],
      details: [`Unknown item type: "${itemType}"`],
    };
  }

  const unknownFields: string[] = [];
  const details: string[] = [];

  for (const field of Object.keys(data)) {
    if (knownNonFieldKeys.has(field)) continue;
    if (isKnownField(field, itemType)) continue;

    unknownFields.push(field);

    const baseFields = schemaBaseFieldsByType.get(itemType);
    if (baseFields?.has(field)) {
      const mapped = (schema.itemTypes as ItemTypeDef[])
        .find(t => t.itemType === itemType)?.fields
        .find(f => f.baseField === field);
      details.push(`"${field}" is a base field → this type uses "${mapped?.field}" instead`);
    } else {
      const validFor: string[] = [];
      for (const [type, fields] of schemaFieldsByType) {
        if (fields.has(field)) validFor.push(type);
      }
      if (validFor.length > 0) {
        details.push(`"${field}" is valid for [${validFor.join(', ')}] but NOT "${itemType}"`);
      } else {
        details.push(`"${field}" is not in any item type schema (non-schema field)`);
      }
    }
  }

  if (unknownFields.length === 0) return null;
  return { itemKey: key, itemType, title, version, unknownFields, details };
}

// ============ Main ============

async function main() {
  const { apiKey, userId } = parseArgs();

  console.error('=== Zotero iOS Sync Diagnostic Tool ===');
  console.error('    (READ-ONLY — no data will be modified)\n');

  const numericUserId = await resolveUserId(apiKey, userId);
  console.error(`Schema version: ${schema.version}\n`);

  const items = await fetchAllItems(apiKey, numericUserId);
  console.error(`\nTotal items fetched: ${items.length}\n`);

  const problems: Problem[] = [];
  for (const item of items) {
    const problem = diagnoseItem(item);
    if (problem) problems.push(problem);
  }

  // ---- Report ----
  console.log('=== iOS Sync Diagnostic Report ===\n');
  console.log(`Total items:          ${items.length}`);
  console.log(`Problematic items:    ${problems.length}`);
  console.log(`Sync-compatible:      ${items.length - problems.length}\n`);

  // All unique data keys
  const allKeys = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item.data || {})) allKeys.add(key);
  }
  console.log(`All unique data keys: ${[...allKeys].sort().join(', ')}\n`);

  if (problems.length === 0) {
    console.log('✓ All items are compatible with iOS schema v40!');
    return;
  }

  // Group by field
  const byField = new Map<string, Problem[]>();
  for (const p of problems) {
    for (const field of p.unknownFields) {
      if (!byField.has(field)) byField.set(field, []);
      byField.get(field)!.push(p);
    }
  }

  console.log('--- Issues grouped by unknown field ---\n');
  for (const [field, fieldItems] of [...byField.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const types = [...new Set(fieldItems.map(i => i.itemType))];
    console.log(`  "${field}" — ${fieldItems.length} item(s), types: [${types.join(', ')}]`);
  }

  console.log('\n--- Problematic items ---\n');
  for (const p of problems) {
    console.log(`[${p.itemKey}] (${p.itemType}) "${p.title}"`);
    console.log(`  Unknown fields: ${p.unknownFields.join(', ')}`);
    for (const d of p.details) console.log(`    → ${d}`);
    console.log();
  }

  // Save JSON report
  const reportPath = path.resolve(__dirname, '../ios-sync-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    summary: { totalItems: items.length, problematicItems: problems.length, schemaVersion: schema.version },
    byField: Object.fromEntries(
      [...byField.entries()].map(([field, fi]) => [field, { count: fi.length, itemTypes: [...new Set(fi.map(i => i.itemType))] }])
    ),
    problems: problems.map(p => ({ key: p.itemKey, version: p.version, itemType: p.itemType, title: p.title, unknownFields: p.unknownFields, details: p.details })),
  }, null, 2));
  console.log(`JSON report saved to: ${reportPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
