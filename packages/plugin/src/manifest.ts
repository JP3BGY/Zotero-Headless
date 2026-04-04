/**
 * Plugin Manifest Validation
 *
 * 使用 Zod 在加载时校验插件清单
 */

import { z } from 'zod';
import type { PluginManifest } from './types.js';
import { PluginManifestError } from './errors.js';

const PluginTypeSchema = z.enum([
  'content-processor',
  'post-processor',
  'command',
  'event',
]);

const ManifestSchema = z.object({
  name: z
    .string()
    .min(1, 'name is required')
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'name must be lowercase alphanumeric with hyphens'),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+/, 'version must be semver format'),
  description: z.string().min(1, 'description is required'),
  author: z.string().optional(),
  provides: z
    .array(PluginTypeSchema)
    .min(1, 'must provide at least one capability'),
});

export function validateManifest(raw: unknown): PluginManifest {
  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new PluginManifestError(
      (raw as any)?.name ?? 'unknown',
      issues,
    );
  }
  return result.data;
}
