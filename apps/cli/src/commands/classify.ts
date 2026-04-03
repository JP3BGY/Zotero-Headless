// @ts-nocheck

import { symbols } from '@zotero-headless/core';
import type { Command } from '../types.js';
import { initModules, getDb, getItems, getCollections, getLibraries } from '../modules.js';
import { displayTitle } from '../utils.js';
import { ProgressBar } from '../progress-bar.js';

export const classifyCommands: Command[] = [
  {
    name: 'classify',
    aliases: ['cl'],
    description: 'Auto-classify items into collections based on tag/author/journal/content analysis',
    options: [
      { name: '--batch', alias: '-b', description: 'Classify all unclassified items' },
      { name: '--all', description: 'Include already-classified items (with --batch)' },
      { name: '--apply', alias: '-a', description: 'Apply the top recommendation (default: dry-run)' },
      { name: '--learn', description: 'Apply and record classification for learning (alias for --apply)' },
      { name: '--threshold', alias: '-t', description: 'Minimum score threshold (0-1)', value: '<N>' },
      { name: '--limit', alias: '-l', description: 'Max items to process in batch mode', value: '<N>' },
      { name: '--max', alias: '-m', description: 'Max recommendations per item', value: '<N>' },
      { name: '--profile', description: 'Show collection profiles' },
      { name: '--export-training', description: 'Export classification training data as JSON' },
      { name: '--train', description: 'Adjust weights based on classification history' },
      { name: '--json', description: 'Output results as JSON' },
    ],
    examples: [
      'zotero classify ABCD1234                  # Classify single item (dry-run)',
      'zotero classify ABCD1234 --apply           # Classify and apply top recommendation',
      'zotero classify ABCD1234 --learn            # Apply and record for learning',
      'zotero classify --batch                    # Batch classify unclassified items',
      'zotero classify --batch --all              # Batch classify all items',
      'zotero classify --batch --apply -t 0.5     # Apply with higher threshold',
      'zotero classify --profile                  # Show collection profiles',
      'zotero classify --export-training           # Export training data as JSON',
      'zotero classify --train                    # Auto-adjust weights from corrections',
    ],
    execute: async (args) => {
      // Parse flags
      const batchMode = args.includes('--batch') || args.includes('-b');
      const applyMode = args.includes('--apply') || args.includes('-a') || args.includes('--learn');
      const learnMode = args.includes('--learn');
      const allMode = args.includes('--all');
      const profileMode = args.includes('--profile');
      const exportTrainingMode = args.includes('--export-training');
      const trainMode = args.includes('--train');
      const jsonMode = args.includes('--json');

      let threshold: number | undefined;
      let limit: number | undefined;
      let maxRec: number | undefined;

      for (let i = 0; i < args.length; i++) {
        if ((args[i] === '--threshold' || args[i] === '-t') && args[i + 1]) {
          threshold = parseFloat(args[++i]);
        } else if ((args[i] === '--limit' || args[i] === '-l') && args[i + 1]) {
          limit = parseInt(args[++i], 10);
        } else if ((args[i] === '--max' || args[i] === '-m') && args[i + 1]) {
          maxRec = parseInt(args[++i], 10);
        }
      }

      // Extract positional args (item key)
      const skipFlags = new Set([
        '--batch', '-b', '--all', '--apply', '-a', '--learn', '--profile', '--json',
        '--threshold', '-t', '--limit', '-l', '--max', '-m',
        '--export-training', '--train',
      ]);
      const positional: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (skipFlags.has(args[i])) {
          if (args[i] === '--threshold' || args[i] === '-t' ||
              args[i] === '--limit' || args[i] === '-l' ||
              args[i] === '--max' || args[i] === '-m') {
            i++;
          }
          continue;
        }
        positional.push(args[i]);
      }

      // Lazy import
      const agentApi = await import('@zotero-headless/agent-api');
      const { configManager } = await import('@zotero-headless/core');
      const classifyConfig = (configManager.get('classify') || {}) as any;

      const effectiveThreshold = threshold ?? classifyConfig.threshold ?? 0.3;
      const effectiveMax = maxRec ?? classifyConfig.maxRecommendations ?? 3;
      const effectiveDryRun = !applyMode && !classifyConfig.autoApply;

      // ─── Export training mode ───
      if (exportTrainingMode) {
        await initModules();
        const data = await agentApi.exportTrainingData();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      // ─── Train mode ───
      if (trainMode) {
        await initModules();
        const result = await agentApi.trainWeights();

        if (result.corrections === 0) {
          console.log(`\n${symbols.info} No correction data found. Use --apply to classify items, then use "zotero mv" to correct misclassifications.\n`);
          return;
        }

        console.log('\nWeight adjustment results:\n');
        console.log(`  Corrections analyzed: ${result.corrections}`);
        console.log('');
        console.log('  Strategy        Before    After     Change');
        console.log('  ─────────────────────────────────────────');
        for (const [key, adj] of Object.entries(result.adjustments)) {
          const change = adj.after - adj.before;
          const sign = change >= 0 ? '+' : '';
          console.log(`  ${key.padEnd(16)} ${adj.before.toFixed(3)}     ${adj.after.toFixed(3)}     ${sign}${change.toFixed(3)}`);
        }
        console.log('');
        console.log(`${symbols.success} Weights saved to ~/.zoterrc`);
        console.log('');
        return;
      }

      // ─── Profile mode ───
      if (profileMode) {
        await initModules();
        console.log('\nBuilding collection profiles...\n');

        const profiles = await agentApi.buildCollectionProfiles();

        if (profiles.length === 0) {
          console.log(`${symbols.info} No collections with items found.`);
          return;
        }

        if (jsonMode) {
          const jsonProfiles = profiles.map(p => ({
            key: p.collectionKey,
            name: p.collectionName,
            path: p.collectionPath,
            itemCount: p.itemCount,
            topTags: Array.from(p.tagDistribution.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([tag, count]) => ({ tag, count })),
            topAuthors: Array.from(p.authorDistribution.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([author, count]) => ({ author, count })),
            topJournals: Array.from(p.journalDistribution.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([journal, count]) => ({ journal, count })),
          }));
          console.log(JSON.stringify(jsonProfiles, null, 2));
          return;
        }

        profiles.sort((a, b) => b.itemCount - a.itemCount);

        for (const p of profiles) {
          const topTags = Array.from(p.tagDistribution.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([tag, count]) => `${tag}(${count})`)
            .join(', ');

          console.log(`  ${p.collectionPath}  [${p.collectionKey}]  (${p.itemCount} items)`);
          if (topTags) {
            console.log(`    Tags: ${topTags}`);
          }

          const topAuthors = Array.from(p.authorDistribution.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([author, count]) => `${author}(${count})`)
            .join(', ');
          if (topAuthors) {
            console.log(`    Authors: ${topAuthors}`);
          }

          const topJournals = Array.from(p.journalDistribution.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([journal, count]) => `${journal}(${count})`)
            .join(', ');
          if (topJournals) {
            console.log(`    Journals: ${topJournals}`);
          }

          console.log();
        }

        console.log(`Total: ${profiles.length} collections with items`);
        return;
      }

      // ─── Batch mode ───
      if (batchMode) {
        await initModules();
        console.log('\nBuilding collection profiles...');

        const pb = new ProgressBar({ total: 0, label: 'Classifying' });
        let pbInitialized = false;

        const result = await agentApi.classifyBatch({
          dryRun: effectiveDryRun,
          threshold: effectiveThreshold,
          maxRecommendations: effectiveMax,
          unclassifiedOnly: !allMode,
          limit,
          onProgress: (p) => {
            if (!pbInitialized) {
              pb.total = p.total;
              pbInitialized = true;
            }
            pb.update(p.current);
          },
        });

        if (pbInitialized) {
          pb.complete();
        }

        if (jsonMode) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log();
        console.log(`  Processed:   ${result.totalProcessed} items`);
        console.log(`  Classified:  ${result.totalClassified} items`);
        console.log(`  Skipped:     ${result.totalSkipped} items (below threshold)`);
        console.log(`  Duration:    ${(result.durationMs / 1000).toFixed(1)}s`);

        if (result.totalClassified > 0) {
          const collectionCounts = new Map<string, { path: string; count: number }>();
          for (const r of result.results) {
            if (r.recommendations.length > 0) {
              const top = r.recommendations[0];
              const entry = collectionCounts.get(top.collectionKey) || { path: top.collectionPath, count: 0 };
              entry.count++;
              collectionCounts.set(top.collectionKey, entry);
            }
          }

          const sorted = Array.from(collectionCounts.values()).sort((a, b) => b.count - a.count).slice(0, 10);
          console.log('\n  Top destinations:');
          for (const entry of sorted) {
            console.log(`    ${entry.path.padEnd(40)} <- ${entry.count} items`);
          }
        }

        if (effectiveDryRun) {
          console.log(`\n  ${symbols.info} Dry-run mode. Use --apply to execute changes.`);
        } else {
          console.log(`\n  ${symbols.success} Applied top recommendations.`);
        }

        console.log();
        return;
      }

      // ─── Single item mode ───
      if (positional.length === 0) {
        console.log('Usage: zotero classify <KEY> [options]');
        console.log('       zotero classify --batch [options]');
        console.log('       zotero classify --profile');
        console.log('       zotero classify --export-training');
        console.log('       zotero classify --train');
        console.log('');
        console.log('Options:');
        console.log('  --apply, -a        Apply top recommendation (default: dry-run)');
        console.log('  --learn            Apply and record for learning');
        console.log('  --batch, -b        Classify all unclassified items');
        console.log('  --all              Include already-classified items');
        console.log('  --threshold, -t    Minimum score threshold (0-1, default: 0.3)');
        console.log('  --limit, -l        Max items in batch mode');
        console.log('  --max, -m          Max recommendations per item (default: 3)');
        console.log('  --profile          Show collection profiles');
        console.log('  --export-training  Export classification training data');
        console.log('  --train            Auto-adjust weights from corrections');
        console.log('  --json             Output as JSON');
        return;
      }

      const itemKey = positional[0];
      await initModules();

      const result = await agentApi.classifyItem(itemKey, {
        dryRun: effectiveDryRun,
        threshold: effectiveThreshold,
        maxRecommendations: effectiveMax,
      });

      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`\nClassifying: "${result.itemTitle}" [${result.itemKey}]`);

      if (result.currentCollections.length > 0) {
        console.log(`  Current: ${result.currentCollections.join(', ')}`);
      }

      if (result.recommendations.length === 0) {
        console.log(`\n  ${symbols.info} No recommendations above threshold (${effectiveThreshold}).`);
        console.log();
        return;
      }

      console.log('\n  Recommendations:');
      for (let i = 0; i < result.recommendations.length; i++) {
        const rec = result.recommendations[i];
        const s = rec.strategyScores;
        let detail = `[tag:${s.tag.toFixed(2)} author:${s.author.toFixed(2)} journal:${s.journal.toFixed(2)} content:${s.content.toFixed(2)}`;
        if (s.rule > 0) detail += ` rule:${s.rule.toFixed(0)}`;
        detail += ']';
        const marker = i === 0 && result.applied ? ` ${symbols.success} applied` : '';
        console.log(`    ${i + 1}. ${rec.collectionPath.padEnd(35)} ${rec.score.toFixed(3)} (${rec.confidence})  ${detail}${marker}`);
      }

      if (effectiveDryRun) {
        console.log(`\n  ${symbols.info} Dry-run mode. Use --apply to add item to the top recommendation.`);
      } else if (result.applied) {
        const msg = learnMode ? 'Item classified and decision recorded for learning.' : `Item added to ${result.recommendations[0].collectionPath}`;
        console.log(`\n  ${symbols.success} ${msg}`);
      }

      console.log();
    },
  },
];
