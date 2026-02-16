import { Command } from 'commander';

export function configureGet(program: Command) {
  const getCommand = program
    .command('get')
    .description('获取特定文献的详细信息')
    .argument('<id>', '文献ID')
    .option('-f, --format <format>', '输出格式 (json, markdown, bibtex)', 'markdown')
    .option('--include-notes', '包含笔记')
    .option('--include-attachments', '包含附件信息')
    .action(async (id, options) => {
      await performGet(id, options);
    });
  
  return getCommand;
}

export async function performGet(
  id: string,
  options: {
    format?: string;
    includeNotes?: boolean;
    includeAttachments?: boolean;
  }
) {
  console.log(`📄 获取文献详情：${id}`);
  
  // 模拟文献详情
  const item = {
    id: id,
    title: '人工智能在医学诊断中的应用研究综述',
    authors: [
      { name: '张伟', affiliation: '清华大学医学院' },
      { name: '李明', affiliation: '北京大学第一医院' },
      { name: '王芳', affiliation: '上海交通大学人工智能研究院' }
    ],
    abstract: '本文系统综述了人工智能技术在医学诊断领域的应用现状与发展趋势。首先介绍了机器学习、深度学习等关键技术，然后分析了其在医学影像诊断、临床决策支持、疾病预测等方面的具体应用，最后展望了未来发展方向与面临的挑战。',
    year: '2023',
    type: 'journalArticle',
    journal: '中国医学影像学杂志',
    volume: '25',
    issue: '3',
    pages: '123-130',
    doi: '10.1234/j.issn.1000-1234.2023.03.001',
    keywords: ['人工智能', '医学诊断', '机器学习', '深度学习', '医学影像'],
    url: 'https://example.com/article/123456',
    collections: ['人工智能', '医学研究', '综述论文'],
    tags: ['AI医疗', '诊断辅助', '综述'],
    pdfPath: `/attachments/${id}.pdf`,
    notes: options.includeNotes ? [
      { id: 'note1', content: '本文涵盖了最新的AI医疗进展，特别是2022-2023年间的研究。' },
      { id: 'note2', content: '作者团队来自多个顶尖机构，提供了全面而深入的视角。' }
    ] : [],
    attachments: options.includeAttachments ? [
      { id: 'att1', name: 'supplementary_data.xlsx', type: 'spreadsheet', size: '1.2MB' },
      { id: 'att2', name: 'code_repository.zip', type: 'archive', size: '850KB' }
    ] : [],
    syncInfo: {
      lastModified: '2023-12-15 14:30:25',
      version: '45',
      source: 'zotero.org'
    }
  };
  
  if (options.format === 'json') {
    console.log(JSON.stringify(item, null, 2));
    return;
  }
  
  if (options.format === 'bibtex') {
    console.log(`@article{${id.replace(/[^a-zA-Z]/g, '')}2023,
  author    = {${item.authors.map(a => a.name).join(' and ')}},
  title     = {${item.title}},
  journal   = {${item.journal}},
  year      = {${item.year}},
  volume    = {${item.volume}},
  number    = {${item.issue}},
  pages     = {${item.pages}},
  doi       = {${item.doi}},
  url       = {${item.url}}
}`);
    return;
  }
  
  // Markdown 格式（默认）
  console.log(`# ${item.title}\n`);
  
  console.log(`**文献类型：** ${item.type}`);
  console.log(`**ID：** ${item.id}\n`);
  
  console.log(`**作者：**`);
  item.authors.forEach((author, index) => {
    console.log(`  ${index + 1}. ${author.name} (${author.affiliation})`);
  });
  
  console.log(`\n**期刊：** ${item.journal}`);
  console.log(`**年份：** ${item.year}`);
  console.log(`**卷/期/页：** ${item.volume}(${item.issue}):${item.pages}`);
  console.log(`**DOI：** ${item.doi}`);
  console.log(`**URL：** ${item.url}\n`);
  
  console.log(`**摘要：**`);
  console.log(`${item.abstract}\n`);
  
  console.log(`**关键词：** ${item.keywords.map(k => `#${k}`).join(' ')}\n`);
  
  console.log(`**收藏夹：** ${item.collections.join(', ')}`);
  console.log(`**标签：** ${item.tags.map(t => `**${t}**`).join(', ')}\n`);
  
  if (item.notes.length > 0) {
    console.log(`---\n**笔记：**\n`);
    item.notes.forEach((note, index) => {
      console.log(`${index + 1}. ${note.content}`);
    });
    console.log();
  }
  
  if (item.attachments.length > 0) {
    console.log(`---\n**附件：**\n`);
    item.attachments.forEach((att, index) => {
      console.log(`${index + 1}. **${att.name}** (${att.type}, ${att.size})`);
    });
    console.log();
  }
  
  console.log(`---\n**同步信息：**`);
  console.log(`- 最后修改：${item.syncInfo.lastModified}`);
  console.log(`- 版本：${item.syncInfo.version}`);
  console.log(`- 来源：${item.syncInfo.source}`);
  console.log(`- PDF路径：${item.pdfPath}`);
  
  console.log(`\n💡 提示：运行 "zotero sync" 获取最新数据`);
}