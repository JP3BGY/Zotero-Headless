import { Command } from 'commander';

export function configureSearch(program: Command) {
  const searchCommand = program
    .command('search')
    .description('搜索文献库')
    .argument('<query>', '搜索关键词')
    .option('-f, --field <field>', '搜索字段 (title, authors, abstract, all)', 'all')
    .option('-c, --case-sensitive', '区分大小写')
    .option('--fuzzy', '模糊搜索')
    .option('--limit <number>', '结果数量限制', '10')
    .option('--format <format>', '输出格式 (json, table, markdown)', 'table')
    .action(async (query, options) => {
      await performSearch(query, options);
    });
  
  return searchCommand;
}

export async function performSearch(
  query: string,
  options: {
    field?: string;
    caseSensitive?: boolean;
    fuzzy?: boolean;
    limit?: string;
    format?: string;
  }
) {
  const limit = parseInt(options.limit || '10');
  
  console.log(`🔍 搜索："${query}"`);
  console.log(`📄 字段：${options.field}`);
  
  if (options.caseSensitive) {
    console.log(`🔠 区分大小写`);
  }
  
  if (options.fuzzy) {
    console.log(`🔍 模糊匹配`);
  }
  
  console.log(`📊 最大结果：${limit}`);
  
  // 模拟搜索结果
  const mockResults = [
    { id: 'XYZ123', title: '深度学习在医学图像分析中的最新进展', authors: ['陈明', '刘芳'], year: '2023', relevance: 0.95 },
    { id: 'ABC789', title: '机器学习算法优化：基于梯度下降的改进', authors: ['李强'], year: '2022', relevance: 0.88 },
    { id: 'DEF456', title: '人工智能在医疗诊断系统中的应用研究', authors: ['王伟', '赵静'], year: '2021', relevance: 0.82 },
    { id: 'GHI321', title: '深度强化学习在游戏AI中的应用', authors: ['孙涛'], year: '2020', relevance: 0.75 },
    { id: 'JKL987', title: '机器学习与深度学习的比较研究', authors: ['周琳', '吴刚'], year: '2019', relevance: 0.68 },
  ];
  
  console.log(`\n✅ 找到 ${mockResults.length} 个相关结果`);
  
  if (options.format === 'json') {
    console.log(JSON.stringify({
      query,
      results: mockResults,
      totalResults: 15,
      searchTime: '0.12s'
    }, null, 2));
  } else if (options.format === 'markdown') {
    console.log(`# 搜索结果：${query}\n`);
    console.log(`**总共找到 15 个结果（显示前 ${mockResults.length} 个）**\n`);
    
    mockResults.forEach((item, index) => {
      console.log(`## ${index + 1}. ${item.title}`);
      console.log(`- **作者：** ${item.authors.join(', ')}`);
      console.log(`- **年份：** ${item.year}`);
      console.log(`- **相关度：** ${(item.relevance * 100).toFixed(1)}%`);
      console.log(`- **ID：** ${item.id}\n`);
    });
  } else {
    // 表格格式
    console.log('\n┌────┬─────────────────────────────────────┬─────────────────┬──────┬─────────┐');
    console.log('│ 排名 │                标题                │      作者       │ 年份 │  相关度  │');
    console.log('├────┼─────────────────────────────────────┼─────────────────┼──────┼─────────┤');
    
    mockResults.forEach((item, index) => {
      const rank = (index + 1).toString().padEnd(2);
      const title = (item.title.length > 33 ? item.title.substring(0, 30) + '...' : item.title).padEnd(37);
      const authors = (item.authors.length > 2 ? item.authors.slice(0, 2).join(', ') + '...' : item.authors.join(', ')).padEnd(15);
      const year = item.year.padEnd(4);
      const relevance = `${(item.relevance * 100).toFixed(1)}%`.padEnd(7);
      
      console.log(`│ ${rank} │ ${title} │ ${authors} │ ${year} │ ${relevance} │`);
    });
    
    console.log('└────┴─────────────────────────────────────┴─────────────────┴──────┴─────────┘');
  }
  
  console.log(`\n💡 提示：使用 "zotero get <ID>" 查看详细内容`);
}