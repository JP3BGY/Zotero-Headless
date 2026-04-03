/**
 * Intelligent Classification Engine
 *
 * 分析条目的标签、作者、期刊、标题/摘要等特征，推荐最匹配的收藏夹。
 * 支持 TF-IDF 标签匹配、作者匹配、期刊匹配、内容相似度、自定义规则五种策略。
 * 支持学习模式：记录分类决策、导出训练数据、自动调权。
 */

import { parseItemData } from '@zotero-headless/types';
import { eq, and, notInArray, desc, count as drizzleCount } from 'drizzle-orm';

// ============ 类型定义 ============

export interface CollectionProfile {
  collectionKey: string;
  collectionName: string;
  collectionPath: string;
  parentKey: string | null;
  itemCount: number;
  tagDistribution: Map<string, number>;
  authorDistribution: Map<string, number>;
  journalDistribution: Map<string, number>;
  wordDistribution: Map<string, number>;
  totalWordCount: number;
}

export interface ClassifyRecommendation {
  collectionKey: string;
  collectionName: string;
  collectionPath: string;
  score: number;
  strategyScores: Record<string, number>;
  confidence: 'high' | 'medium' | 'low';
}

export interface ClassifyResult {
  itemKey: string;
  itemTitle: string;
  currentCollections: string[];
  recommendations: ClassifyRecommendation[];
  applied: boolean;
}

export interface ClassifyBatchResult {
  results: ClassifyResult[];
  totalProcessed: number;
  totalClassified: number;
  totalSkipped: number;
  durationMs: number;
}

export interface ClassifyOptions {
  dryRun?: boolean;
  threshold?: number;
  maxRecommendations?: number;
  strategyWeights?: { tag?: number; author?: number; journal?: number; content?: number };
  excludeCollections?: string[];
  includeCollections?: string[];
  onProgress?: (progress: { current: number; total: number; itemKey: string; percentage: number }) => void;
}

export interface ClassifyBatchOptions extends ClassifyOptions {
  unclassifiedOnly?: boolean;
  limit?: number;
  itemTypes?: string[];
}

export interface ClassificationLogEntry {
  itemKey: string;
  itemTitle: string | null;
  recommendedCollection: string;
  chosenCollection: string | null;
  score: number;
  strategyScores: Record<string, number>;
  weights: Record<string, number>;
  source: string;
  isCorrection: boolean;
  timestamp: number;
}

export interface TrainResult {
  originalWeights: StrategyWeights;
  adjustedWeights: StrategyWeights;
  totalEntries: number;
  corrections: number;
  adjustments: Record<string, { before: number; after: number }>;
}

// ============ 延迟加载 ============

let dbModule: any;
async function getDb() {
  if (!dbModule) {
    dbModule = await import('@zotero-headless/database');
  }
  return dbModule;
}

// ============ 画像缓存 ============

interface ProfileCache {
  profiles: CollectionProfile[];
  idf: Map<string, number>;
  wordIdf: Map<string, number>;
  itemCount: number;
  collectionCount: number;
  builtAt: number;
  optionsKey: string;
}

let profileCache: ProfileCache | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * 清除画像缓存。同步后应调用此函数。
 */
export function invalidateProfileCache(): void {
  profileCache = null;
}

async function getOrBuildProfiles(options?: {
  excludeCollections?: string[];
  includeCollections?: string[];
  forceRefresh?: boolean;
}): Promise<{ profiles: CollectionProfile[]; idf: Map<string, number>; wordIdf: Map<string, number> }> {
  const optionsKey = JSON.stringify({
    exclude: options?.excludeCollections?.slice().sort(),
    include: options?.includeCollections?.slice().sort(),
  });

  if (!options?.forceRefresh && profileCache && profileCache.optionsKey === optionsKey) {
    const age = Date.now() - profileCache.builtAt;
    if (age < CACHE_TTL_MS) {
      // 快速校验条目/收藏夹数量是否变化
      const { getDatabase, items, collections, libraries } = await getDb();
      const db = getDatabase();
      const library = await db.select().from(libraries).get();
      if (library) {
        const itemCountResult = await db.select({ count: drizzleCount() })
          .from(items)
          .where(and(eq(items.libraryId, library.id), eq(items.deleted, false)))
          .get();
        const colCountResult = await db.select({ count: drizzleCount() })
          .from(collections)
          .where(and(eq(collections.libraryId, library.id), eq(collections.deleted, false)))
          .get();
        if (itemCountResult?.count === profileCache.itemCount &&
            colCountResult?.count === profileCache.collectionCount) {
          return { profiles: profileCache.profiles, idf: profileCache.idf, wordIdf: profileCache.wordIdf };
        }
      }
    }
  }

  // 重建
  const profiles = await buildCollectionProfiles({
    excludeCollections: options?.excludeCollections,
    includeCollections: options?.includeCollections,
  });
  const idf = computeTagIDF(profiles);
  const wordIdf = computeWordIDF(profiles);

  // 获取总数用于缓存校验
  const { getDatabase, items, collections, libraries } = await getDb();
  const db = getDatabase();
  const library = await db.select().from(libraries).get();
  let itemCount = 0;
  let collectionCount = 0;
  if (library) {
    const ic = await db.select({ count: drizzleCount() })
      .from(items)
      .where(and(eq(items.libraryId, library.id), eq(items.deleted, false)))
      .get();
    const cc = await db.select({ count: drizzleCount() })
      .from(collections)
      .where(and(eq(collections.libraryId, library.id), eq(collections.deleted, false)))
      .get();
    itemCount = ic?.count ?? 0;
    collectionCount = cc?.count ?? 0;
  }

  profileCache = { profiles, idf, wordIdf, itemCount, collectionCount, builtAt: Date.now(), optionsKey };
  return { profiles, idf, wordIdf };
}

// ============ 内部类型 ============

interface ItemRecord {
  key: string;
  title: string | null;
  itemType: string;
  journal: string | null;
  creators: string;
  collectionKeys: string;
  tags: string;
  abstract: string | null;
}

interface ParsedItem {
  key: string;
  title: string;
  tags: string[];
  authors: string[];
  journal: string | null;
  collectionKeys: string[];
  textTokens: string[];
}

const CHILD_ITEM_TYPES = ['attachment', 'note', 'annotation'];

// ============ 停用词 ============

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'not', 'no',
  'its', 'it', 'this', 'that', 'these', 'those', 'he', 'she', 'they', 'we', 'you', 'i', 'me',
  'my', 'his', 'her', 'our', 'their', 'your', 'which', 'who', 'whom', 'what', 'when', 'where',
  'how', 'why', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
  'than', 'too', 'very', 'just', 'about', 'above', 'after', 'again', 'also', 'am', 'any',
  'because', 'before', 'between', 'during', 'here', 'if', 'into', 'only', 'own', 'same',
  'so', 'then', 'there', 'through', 'under', 'until', 'up', 'while',
  // 学术常见填充词
  'using', 'based', 'study', 'analysis', 'results', 'method', 'methods', 'approach',
  'show', 'shows', 'shown', 'effect', 'effects', 'however', 'although', 'thus',
  'therefore', 'among', 'within', 'without', 'including', 'compared', 'associated',
  'used', 'found', 'provide', 'provides', 'suggest', 'suggests', 'demonstrate',
  'performed', 'investigated', 'examined', 'observed', 'obtained', 'proposed',
  'conclusion', 'conclusions', 'objective', 'background', 'purpose', 'introduction',
  'data', 'significant', 'significantly', 'respectively', 'total', 'overall',
]);

// ============ 辅助函数 ============

function parseCreatorName(creator: any): string | null {
  if (creator.name) return creator.name.toLowerCase().trim();
  if (creator.lastName) {
    const first = creator.firstName?.trim() || '';
    return `${creator.lastName.trim()}, ${first}`.toLowerCase();
  }
  return null;
}

// CJK Unicode ranges
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}]/u;

function tokenizeText(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const tokens: string[] = [];

  // Split into segments: CJK characters become individual tokens, Latin text is split on non-alpha
  let buf = '';
  for (const ch of lower) {
    if (CJK_REGEX.test(ch)) {
      // Flush Latin buffer
      if (buf) {
        for (const w of buf.split(/[^a-z0-9]+/)) {
          if (w.length >= 2 && !STOP_WORDS.has(w)) tokens.push(w);
        }
        buf = '';
      }
      tokens.push(ch);
    } else {
      buf += ch;
    }
  }
  // Flush remaining buffer
  if (buf) {
    for (const w of buf.split(/[^a-z0-9]+/)) {
      if (w.length >= 2 && !STOP_WORDS.has(w)) tokens.push(w);
    }
  }

  return tokens;
}

function parseItemRecord(record: ItemRecord): ParsedItem {
  let tags: string[] = [];
  try {
    const parsed: any[] = JSON.parse(record.tags || '[]');
    tags = parsed.map((t: any) => (typeof t === 'string' ? t : t.tag || '').toLowerCase().trim()).filter(Boolean);
  } catch { /* empty */ }

  let authors: string[] = [];
  try {
    const parsed: any[] = JSON.parse(record.creators || '[]');
    authors = parsed.map(parseCreatorName).filter((n): n is string => n !== null);
  } catch { /* empty */ }

  let collectionKeys: string[] = [];
  try {
    collectionKeys = JSON.parse(record.collectionKeys || '[]');
  } catch { /* empty */ }

  const text = [record.title || '', record.abstract || ''].join(' ');
  const textTokens = tokenizeText(text);

  return {
    key: record.key,
    title: record.title || '(untitled)',
    tags,
    authors,
    journal: record.journal?.toLowerCase().trim() || null,
    collectionKeys,
    textTokens,
  };
}

function buildCollectionPath(
  col: { key: string; name: string; parentKey: string | null },
  byKey: Map<string, { key: string; name: string; parentKey: string | null }>,
): string {
  const parts: string[] = [col.name];
  let current = col;
  while (current.parentKey && byKey.has(current.parentKey)) {
    current = byKey.get(current.parentKey)!;
    parts.unshift(current.name);
  }
  return '/' + parts.join('/');
}

// ============ 画像构建 ============

/**
 * 构建所有活跃收藏夹的统计画像。
 */
export async function buildCollectionProfiles(
  options?: { excludeCollections?: string[]; includeCollections?: string[] },
): Promise<CollectionProfile[]> {
  const { getDatabase, items, collections, libraries } = await getDb();
  const db = getDatabase();

  const library = await db.select().from(libraries).get();
  if (!library) return [];

  const allCols = await db.select({
    key: collections.key,
    name: collections.name,
    parentKey: collections.parentKey,
  })
    .from(collections)
    .where(and(eq(collections.libraryId, library.id), eq(collections.deleted, false)))
    .all();

  const byKey = new Map<string, typeof allCols[number]>();
  for (const col of allCols) byKey.set(col.key, col);

  let targetCols = allCols;
  if (options?.includeCollections?.length) {
    const include = new Set(options.includeCollections);
    targetCols = allCols.filter((c: any) => include.has(c.key));
  }
  if (options?.excludeCollections?.length) {
    const exclude = new Set(options.excludeCollections);
    targetCols = targetCols.filter((c: any) => !exclude.has(c.key));
  }

  const allItems: ItemRecord[] = await db.select({
    key: items.key,
    title: items.title,
    itemType: items.itemType,
    journal: items.journal,
    creators: items.creators,
    collectionKeys: items.collectionKeys,
    tags: items.tags,
    abstract: items.abstract,
  })
    .from(items)
    .where(
      and(
        eq(items.libraryId, library.id),
        eq(items.deleted, false),
        notInArray(items.itemType, CHILD_ITEM_TYPES),
      ),
    )
    .all();

  const profileMap = new Map<string, CollectionProfile>();
  for (const col of targetCols) {
    profileMap.set(col.key, {
      collectionKey: col.key,
      collectionName: col.name,
      collectionPath: buildCollectionPath(col, byKey),
      parentKey: col.parentKey,
      itemCount: 0,
      tagDistribution: new Map(),
      authorDistribution: new Map(),
      journalDistribution: new Map(),
      wordDistribution: new Map(),
      totalWordCount: 0,
    });
  }

  for (const record of allItems) {
    const parsed = parseItemRecord(record);

    for (const colKey of parsed.collectionKeys) {
      const profile = profileMap.get(colKey);
      if (!profile) continue;

      profile.itemCount++;

      for (const tag of parsed.tags) {
        profile.tagDistribution.set(tag, (profile.tagDistribution.get(tag) || 0) + 1);
      }

      for (const author of parsed.authors) {
        profile.authorDistribution.set(author, (profile.authorDistribution.get(author) || 0) + 1);
      }

      if (parsed.journal) {
        profile.journalDistribution.set(parsed.journal, (profile.journalDistribution.get(parsed.journal) || 0) + 1);
      }

      for (const word of parsed.textTokens) {
        profile.wordDistribution.set(word, (profile.wordDistribution.get(word) || 0) + 1);
        profile.totalWordCount++;
      }
    }
  }

  return Array.from(profileMap.values()).filter(p => p.itemCount > 0);
}

// ============ 评分策略 ============

function computeTagIDF(profiles: CollectionProfile[]): Map<string, number> {
  const totalCollections = profiles.length;
  const tagCollectionCount = new Map<string, number>();
  for (const profile of profiles) {
    for (const tag of profile.tagDistribution.keys()) {
      tagCollectionCount.set(tag, (tagCollectionCount.get(tag) || 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [tag, count] of tagCollectionCount) {
    idf.set(tag, Math.log(totalCollections / count));
  }
  return idf;
}

function computeWordIDF(profiles: CollectionProfile[]): Map<string, number> {
  const totalCollections = profiles.length;
  const wordCollectionCount = new Map<string, number>();
  for (const profile of profiles) {
    for (const word of profile.wordDistribution.keys()) {
      wordCollectionCount.set(word, (wordCollectionCount.get(word) || 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [word, count] of wordCollectionCount) {
    idf.set(word, Math.log(totalCollections / count));
  }
  return idf;
}

function scoreByTags(
  itemTags: string[],
  profile: CollectionProfile,
  idf: Map<string, number>,
): number {
  if (itemTags.length === 0 || profile.itemCount === 0) return 0;
  let score = 0;
  let maxPossibleScore = 0;
  for (const tag of itemTags) {
    const tagIdf = idf.get(tag) || 0;
    maxPossibleScore += tagIdf;
    const freq = profile.tagDistribution.get(tag);
    if (freq !== undefined) {
      score += (freq / profile.itemCount) * tagIdf;
    }
  }
  return maxPossibleScore > 0 ? Math.min(score / maxPossibleScore, 1) : 0;
}

function scoreByAuthors(
  itemAuthors: string[],
  profile: CollectionProfile,
): number {
  if (itemAuthors.length === 0 || profile.itemCount === 0) return 0;
  let score = 0;
  for (const author of itemAuthors) {
    const freq = profile.authorDistribution.get(author);
    if (freq !== undefined) {
      score += freq / profile.itemCount;
    }
  }
  return Math.min(score / itemAuthors.length, 1);
}

function scoreByJournal(
  journal: string | null,
  profile: CollectionProfile,
): number {
  if (!journal || profile.itemCount === 0) return 0;
  const freq = profile.journalDistribution.get(journal);
  if (freq === undefined) return 0;
  return Math.min(freq / profile.itemCount, 1);
}

function scoreByContent(
  itemTokens: string[],
  profile: CollectionProfile,
  wordIdf: Map<string, number>,
): number {
  if (itemTokens.length === 0 || profile.totalWordCount === 0) return 0;

  // 构建 item 词频
  const itemTF = new Map<string, number>();
  for (const token of itemTokens) {
    itemTF.set(token, (itemTF.get(token) || 0) + 1);
  }
  const itemTotal = itemTokens.length;

  // 计算余弦相似度 (TF-IDF 加权)
  let dot = 0;
  let normItem = 0;
  let normCol = 0;

  for (const [word, count] of itemTF) {
    const idfVal = wordIdf.get(word) || 0;
    const itemTfIdf = (count / itemTotal) * idfVal;
    normItem += itemTfIdf * itemTfIdf;

    const colFreq = profile.wordDistribution.get(word);
    if (colFreq !== undefined) {
      const colTfIdf = (colFreq / profile.totalWordCount) * idfVal;
      dot += itemTfIdf * colTfIdf;
    }
  }

  // 为 collection 侧的 norm，只需计算与 item 有交集的词
  for (const [word, count] of itemTF) {
    const colFreq = profile.wordDistribution.get(word);
    if (colFreq !== undefined) {
      const idfVal = wordIdf.get(word) || 0;
      const colTfIdf = (colFreq / profile.totalWordCount) * idfVal;
      normCol += colTfIdf * colTfIdf;
    }
  }

  if (normItem === 0 || normCol === 0) return 0;
  return Math.min(dot / (Math.sqrt(normItem) * Math.sqrt(normCol)), 1);
}

// ============ 自定义规则 ============

interface ClassifyRule {
  authors?: string[];
  journals?: string[];
  tags?: string[];
  collection: string;
}

interface ResolvedRule {
  authors: string[];
  journals: string[];
  tags: string[];
  collectionKey: string;
}

function resolveRules(rules: ClassifyRule[], profiles: CollectionProfile[]): ResolvedRule[] {
  const resolved: ResolvedRule[] = [];

  for (const rule of rules) {
    // 按名称或路径匹配收藏夹
    const target = rule.collection.toLowerCase().trim();
    let matchedKey: string | null = null;

    for (const p of profiles) {
      if (p.collectionPath.toLowerCase() === target || p.collectionName.toLowerCase() === target) {
        matchedKey = p.collectionKey;
        break;
      }
    }

    if (!matchedKey) continue; // 无法解析的规则跳过

    resolved.push({
      authors: (rule.authors || []).map(a => a.toLowerCase().trim()),
      journals: (rule.journals || []).map(j => j.toLowerCase().trim()),
      tags: (rule.tags || []).map(t => t.toLowerCase().trim()),
      collectionKey: matchedKey,
    });
  }

  return resolved;
}

function scoreByRules(parsed: ParsedItem, resolvedRules: ResolvedRule[]): Map<string, number> {
  const bonuses = new Map<string, number>();

  for (const rule of resolvedRules) {
    let matched = false;

    if (rule.authors.length > 0 && parsed.authors.some(a => rule.authors.some(ra => a.includes(ra) || ra.includes(a)))) {
      matched = true;
    }

    if (!matched && rule.journals.length > 0 && parsed.journal && rule.journals.some(j => parsed.journal!.includes(j) || j.includes(parsed.journal!))) {
      matched = true;
    }

    if (!matched && rule.tags.length > 0 && parsed.tags.some(t => rule.tags.includes(t))) {
      matched = true;
    }

    if (matched) {
      bonuses.set(rule.collectionKey, 1.0);
    }
  }

  return bonuses;
}

// ============ 综合评分 ============

interface StrategyWeights {
  tag: number;
  author: number;
  journal: number;
  content: number;
}

const DEFAULT_WEIGHTS: StrategyWeights = { tag: 0.5, author: 0.15, journal: 0.15, content: 0.2 };

function scoreItem(
  parsed: ParsedItem,
  profile: CollectionProfile,
  idf: Map<string, number>,
  wordIdf: Map<string, number>,
  weights: StrategyWeights,
  ruleBonus: number,
): { composite: number; scores: Record<string, number> } {
  const tagScore = scoreByTags(parsed.tags, profile, idf);
  const authorScore = scoreByAuthors(parsed.authors, profile);
  const journalScore = scoreByJournal(parsed.journal, profile);
  const contentScore = scoreByContent(parsed.textTokens, profile, wordIdf);

  const totalWeight = weights.tag + weights.author + weights.journal + weights.content;
  const weighted = totalWeight > 0
    ? (weights.tag * tagScore + weights.author * authorScore + weights.journal * journalScore + weights.content * contentScore) / totalWeight
    : 0;

  const composite = Math.min(weighted + ruleBonus, 1);

  return {
    composite,
    scores: {
      tag: tagScore,
      author: authorScore,
      journal: journalScore,
      content: contentScore,
      rule: ruleBonus,
    },
  };
}

function getConfidence(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.6) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

function roundScore(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ============ 学习模式：记录 ============

async function recordClassification(params: {
  itemKey: string;
  itemTitle: string;
  libraryId: number;
  recommendedCollectionKey: string;
  recommendedCollectionName: string;
  chosenCollectionKey: string | null;
  chosenCollectionName: string | null;
  score: number;
  strategyScores: Record<string, number>;
  weights: StrategyWeights;
  source: 'classify-apply' | 'mv';
  isCorrection: boolean;
}): Promise<void> {
  try {
    const { getDatabase, classificationLog } = await getDb();
    const db = getDatabase();
    await db.insert(classificationLog).values({
      itemKey: params.itemKey,
      libraryId: params.libraryId,
      itemTitle: params.itemTitle,
      recommendedCollectionKey: params.recommendedCollectionKey,
      recommendedCollectionName: params.recommendedCollectionName,
      chosenCollectionKey: params.chosenCollectionKey,
      chosenCollectionName: params.chosenCollectionName,
      score: Math.round(params.score * 1000),
      strategyScoresJson: JSON.stringify(params.strategyScores),
      weightsJson: JSON.stringify(params.weights),
      source: params.source,
      isCorrection: params.isCorrection,
      createdAt: Math.floor(Date.now() / 1000),
    }).run();
  } catch {
    // 不阻塞主流程
  }
}

// ============ 加载配置中的规则 ============

async function loadConfigRules(): Promise<ClassifyRule[]> {
  try {
    const { configManager } = await import('@zotero-headless/core');
    const classifyConfig = configManager.get('classify');
    return (classifyConfig as any)?.rules || [];
  } catch {
    return [];
  }
}

// ============ 公共 API ============

/**
 * 分类单个条目，返回推荐的收藏夹列表。
 */
export async function classifyItem(
  itemKey: string,
  options: ClassifyOptions = {},
): Promise<ClassifyResult> {
  const {
    dryRun = true,
    threshold = 0.3,
    maxRecommendations = 3,
    strategyWeights,
    excludeCollections,
    includeCollections,
  } = options;

  const weights: StrategyWeights = {
    tag: strategyWeights?.tag ?? DEFAULT_WEIGHTS.tag,
    author: strategyWeights?.author ?? DEFAULT_WEIGHTS.author,
    journal: strategyWeights?.journal ?? DEFAULT_WEIGHTS.journal,
    content: strategyWeights?.content ?? DEFAULT_WEIGHTS.content,
  };

  const { getDatabase, items, libraries } = await getDb();
  const db = getDatabase();
  const library = await db.select().from(libraries).get();
  if (!library) throw new Error('No library found. Run sync first.');

  const record: ItemRecord | undefined = await db.select({
    key: items.key,
    title: items.title,
    itemType: items.itemType,
    journal: items.journal,
    creators: items.creators,
    collectionKeys: items.collectionKeys,
    tags: items.tags,
    abstract: items.abstract,
  })
    .from(items)
    .where(and(eq(items.key, itemKey), eq(items.libraryId, library.id)))
    .get();

  if (!record) throw new Error(`Item not found: ${itemKey}`);

  const parsed = parseItemRecord(record);

  const { profiles, idf, wordIdf } = await getOrBuildProfiles({ excludeCollections, includeCollections });

  // 加载规则
  const configRules = await loadConfigRules();
  const resolvedRules = resolveRules(configRules, profiles);
  const ruleBonuses = scoreByRules(parsed, resolvedRules);

  const recommendations: ClassifyRecommendation[] = [];
  for (const profile of profiles) {
    const ruleBonus = ruleBonuses.get(profile.collectionKey) || 0;
    const { composite, scores } = scoreItem(parsed, profile, idf, wordIdf, weights, ruleBonus);
    if (composite >= threshold) {
      recommendations.push({
        collectionKey: profile.collectionKey,
        collectionName: profile.collectionName,
        collectionPath: profile.collectionPath,
        score: roundScore(composite),
        strategyScores: Object.fromEntries(
          Object.entries(scores).map(([k, v]) => [k, roundScore(v)]),
        ),
        confidence: getConfidence(composite),
      });
    }
  }

  recommendations.sort((a, b) => b.score - a.score);
  const topRecommendations = recommendations.slice(0, maxRecommendations);

  let applied = false;
  if (!dryRun && topRecommendations.length > 0) {
    const topRec = topRecommendations[0];
    if (!parsed.collectionKeys.includes(topRec.collectionKey)) {
      const { batchAddToCollection } = await import('./batch.js');
      await batchAddToCollection([itemKey], topRec.collectionKey);
      applied = true;

      // 记录分类决策
      await recordClassification({
        itemKey: parsed.key,
        itemTitle: parsed.title,
        libraryId: library.id,
        recommendedCollectionKey: topRec.collectionKey,
        recommendedCollectionName: topRec.collectionName,
        chosenCollectionKey: topRec.collectionKey,
        chosenCollectionName: topRec.collectionName,
        score: topRec.score,
        strategyScores: topRec.strategyScores,
        weights,
        source: 'classify-apply',
        isCorrection: false,
      });
    }
  }

  return {
    itemKey: parsed.key,
    itemTitle: parsed.title,
    currentCollections: parsed.collectionKeys,
    recommendations: topRecommendations,
    applied,
  };
}

/**
 * 批量分类条目。
 */
export async function classifyBatch(
  options: ClassifyBatchOptions = {},
): Promise<ClassifyBatchResult> {
  const startTime = Date.now();

  const {
    dryRun = true,
    threshold = 0.3,
    maxRecommendations = 3,
    strategyWeights,
    excludeCollections,
    includeCollections,
    unclassifiedOnly = true,
    limit,
    itemTypes,
    onProgress,
  } = options;

  const weights: StrategyWeights = {
    tag: strategyWeights?.tag ?? DEFAULT_WEIGHTS.tag,
    author: strategyWeights?.author ?? DEFAULT_WEIGHTS.author,
    journal: strategyWeights?.journal ?? DEFAULT_WEIGHTS.journal,
    content: strategyWeights?.content ?? DEFAULT_WEIGHTS.content,
  };

  const { getDatabase, items, libraries } = await getDb();
  const db = getDatabase();
  const library = await db.select().from(libraries).get();
  if (!library) throw new Error('No library found. Run sync first.');

  const { profiles, idf, wordIdf } = await getOrBuildProfiles({ excludeCollections, includeCollections });

  const configRules = await loadConfigRules();
  const resolvedRules = resolveRules(configRules, profiles);

  let allRecords: ItemRecord[] = await db.select({
    key: items.key,
    title: items.title,
    itemType: items.itemType,
    journal: items.journal,
    creators: items.creators,
    collectionKeys: items.collectionKeys,
    tags: items.tags,
    abstract: items.abstract,
  })
    .from(items)
    .where(
      and(
        eq(items.libraryId, library.id),
        eq(items.deleted, false),
        notInArray(items.itemType, CHILD_ITEM_TYPES),
      ),
    )
    .all();

  if (itemTypes?.length) {
    const allowed = new Set(itemTypes);
    allRecords = allRecords.filter(r => allowed.has(r.itemType));
  }

  let candidates = allRecords.map(parseItemRecord);
  if (unclassifiedOnly) {
    candidates = candidates.filter(p => p.collectionKeys.length === 0);
  }
  if (limit && limit > 0) {
    candidates = candidates.slice(0, limit);
  }

  const results: ClassifyResult[] = [];
  let totalClassified = 0;
  let totalSkipped = 0;

  for (let i = 0; i < candidates.length; i++) {
    const parsed = candidates[i];
    const ruleBonuses = scoreByRules(parsed, resolvedRules);

    const recommendations: ClassifyRecommendation[] = [];
    for (const profile of profiles) {
      const ruleBonus = ruleBonuses.get(profile.collectionKey) || 0;
      const { composite, scores } = scoreItem(parsed, profile, idf, wordIdf, weights, ruleBonus);
      if (composite >= threshold) {
        recommendations.push({
          collectionKey: profile.collectionKey,
          collectionName: profile.collectionName,
          collectionPath: profile.collectionPath,
          score: roundScore(composite),
          strategyScores: Object.fromEntries(
            Object.entries(scores).map(([k, v]) => [k, roundScore(v)]),
          ),
          confidence: getConfidence(composite),
        });
      }
    }

    recommendations.sort((a, b) => b.score - a.score);
    const topRecommendations = recommendations.slice(0, maxRecommendations);

    let applied = false;
    if (topRecommendations.length > 0) {
      totalClassified++;
      if (!dryRun) {
        const topRec = topRecommendations[0];
        if (!parsed.collectionKeys.includes(topRec.collectionKey)) {
          const { batchAddToCollection } = await import('./batch.js');
          await batchAddToCollection([parsed.key], topRec.collectionKey);
          applied = true;

          await recordClassification({
            itemKey: parsed.key,
            itemTitle: parsed.title,
            libraryId: library.id,
            recommendedCollectionKey: topRec.collectionKey,
            recommendedCollectionName: topRec.collectionName,
            chosenCollectionKey: topRec.collectionKey,
            chosenCollectionName: topRec.collectionName,
            score: topRec.score,
            strategyScores: topRec.strategyScores,
            weights,
            source: 'classify-apply',
            isCorrection: false,
          });
        }
      }
    } else {
      totalSkipped++;
    }

    results.push({
      itemKey: parsed.key,
      itemTitle: parsed.title,
      currentCollections: parsed.collectionKeys,
      recommendations: topRecommendations,
      applied,
    });

    if (onProgress) {
      onProgress({
        current: i + 1,
        total: candidates.length,
        itemKey: parsed.key,
        percentage: Math.round(((i + 1) / candidates.length) * 100),
      });
    }
  }

  return {
    results,
    totalProcessed: candidates.length,
    totalClassified,
    totalSkipped,
    durationMs: Date.now() - startTime,
  };
}

// ============ 学习模式：导出训练数据 ============

/**
 * 导出分类记录数据。
 */
export async function exportTrainingData(): Promise<ClassificationLogEntry[]> {
  const { getDatabase, classificationLog } = await getDb();
  const db = getDatabase();

  const rows = await db.select().from(classificationLog).orderBy(desc(classificationLog.createdAt)).all();

  return rows.map((row: any) => ({
    itemKey: row.itemKey,
    itemTitle: row.itemTitle,
    recommendedCollection: row.recommendedCollectionName || row.recommendedCollectionKey,
    chosenCollection: row.chosenCollectionName || row.chosenCollectionKey || null,
    score: (row.score || 0) / 1000,
    strategyScores: row.strategyScoresJson ? JSON.parse(row.strategyScoresJson) : {},
    weights: row.weightsJson ? JSON.parse(row.weightsJson) : {},
    source: row.source,
    isCorrection: !!row.isCorrection,
    timestamp: row.createdAt,
  }));
}

// ============ 学习模式：权重调整 ============

/**
 * 基于分类记录中的修正信息自动调整策略权重。
 */
export async function trainWeights(): Promise<TrainResult> {
  const { getDatabase, classificationLog } = await getDb();
  const db = getDatabase();

  // 加载当前权重
  let currentWeights: StrategyWeights = { ...DEFAULT_WEIGHTS };
  try {
    const { configManager } = await import('@zotero-headless/core');
    const cfg = configManager.get('classify') as any;
    if (cfg?.weights) {
      currentWeights = {
        tag: cfg.weights.tag ?? DEFAULT_WEIGHTS.tag,
        author: cfg.weights.author ?? DEFAULT_WEIGHTS.author,
        journal: cfg.weights.journal ?? DEFAULT_WEIGHTS.journal,
        content: cfg.weights.content ?? DEFAULT_WEIGHTS.content,
      };
    }
  } catch { /* use defaults */ }

  const originalWeights = { ...currentWeights };

  // 加载修正记录
  const corrections = await db.select()
    .from(classificationLog)
    .where(eq(classificationLog.isCorrection, true))
    .all();

  const totalEntries = corrections.length;
  if (totalEntries === 0) {
    return {
      originalWeights,
      adjustedWeights: { ...originalWeights },
      totalEntries: 0,
      corrections: 0,
      adjustments: {},
    };
  }

  // 统计每个策略的"误导"次数
  const strategyKeys = ['tag', 'author', 'journal', 'content'] as const;
  const errorCounts: Record<string, number> = {};
  for (const key of strategyKeys) errorCounts[key] = 0;

  for (const row of corrections) {
    let scores: Record<string, number> = {};
    try {
      scores = JSON.parse((row as any).strategyScoresJson || '{}');
    } catch { continue; }

    // 得分最高的策略被认为最"误导"了推荐
    let maxKey = '';
    let maxVal = -1;
    for (const key of strategyKeys) {
      if ((scores[key] ?? 0) > maxVal) {
        maxVal = scores[key] ?? 0;
        maxKey = key;
      }
    }
    if (maxKey) errorCounts[maxKey]++;
  }

  // 调整权重
  const learningRate = 0.1;
  const numStrategies = strategyKeys.length;
  const adjustments: Record<string, { before: number; after: number }> = {};

  for (const key of strategyKeys) {
    const errorRate = errorCounts[key] / totalEntries;
    const adjustment = -learningRate * (errorRate - 1 / numStrategies);
    const newWeight = Math.max(0.05, currentWeights[key] + adjustment);
    adjustments[key] = { before: currentWeights[key], after: newWeight };
    currentWeights[key] = newWeight;
  }

  // 归一化
  const sum = strategyKeys.reduce((s, k) => s + currentWeights[k], 0);
  for (const key of strategyKeys) {
    currentWeights[key] = Math.round((currentWeights[key] / sum) * 1000) / 1000;
    adjustments[key].after = currentWeights[key];
  }

  // 保存到配置
  try {
    const { configManager } = await import('@zotero-headless/core');
    const existing = configManager.get('classify') || {};
    configManager.set('classify', {
      ...existing,
      weights: {
        tag: currentWeights.tag,
        author: currentWeights.author,
        journal: currentWeights.journal,
        content: currentWeights.content,
      },
    });
  } catch { /* 保存失败不阻塞 */ }

  return {
    originalWeights,
    adjustedWeights: { ...currentWeights },
    totalEntries,
    corrections: totalEntries,
    adjustments,
  };
}
