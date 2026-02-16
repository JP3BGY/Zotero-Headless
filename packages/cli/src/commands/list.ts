import { Command } from 'commander';

export function configureList(program: Command) {
  const listCommand = program
    .command('list')
    .description('列出文献库中的项目')
    .option('-l, --limit <number>', '显示数量限制', '20')
    .option('-s, --skip <number>', '跳过的项目数量', '0')
    .option('--since <date>', '只显示指定日期之后的项目')
    .option('--collection <name>', '限制到特定收藏夹')
    .option('--tag <tag>', '按标签过滤')
    .option('--format <format>', '输出格式 (json, table, csv)', 'table')
    .action(async (options) => {
      await performList(options);
    });
  
  return listCommand;
}

export async function performList(options: {
  limit?: string;
  skip?: string;
  since?: string;
  collection?: string;
  tag?: string;
  format?: string;
}) {
  const limit = parseInt(options.limit || '20');
  const skip = parseInt(options.skip || '0');
  
  console.log(`📚 显示 ${limit} 个项目（跳过 ${skip} 个）`);
  
  if (options.collection) {
    console.log(`📁 收藏夹：${options.collection}`);
  }
  
  if (options.tag) {
    console.log(`🏷️  标签：${options.tag}`);
  }
  
  if (options.since) {
    console.log(`📅 日期范围：${options.since} 之后`);
  }
  
  console.log(`📊 输出格式：${options.format}`);
  
  // 模拟数据
  const mockItems = [
    { id: 'ABC123', title: '人工智能在医学诊断中的应用', authors: ['张伟', '李明'], year: '2023', type: 'journalArticle' },
    { id: 'DEF456', title: '量子计算的进展与挑战', authors: ['王芳'], year: '2022', type: 'conferencePaper' },
    { id: 'GHI789', title: '气候变化对农业生态系统的影响', authors: ['赵强', '孙静'], year: '2021', type: 'book' },
    { id: 'JKL012', title: '区块链技术在金融领域的应用研究', authors: ['周涛'], year: '2020', type: 'thesis' },
    { id: 'MNO345', title: '机器学习算法在图像识别中的优化', authors: ['吴刚', '郑丽'], year: '2019', type: 'journalArticle' },
  ];
  
  if (options.format === 'json') {
    console.log(JSON.stringify(mockItems, null, 2));
  } else if (options.format === 'csv') {
    console.log('ID,Title,Authors,Year,Type');
    mockItems.forEach(item => {
      console.log(`${item.id},"${item.title}","${item.authors.join('; ')}",${item.year},${item.type}`);
    });
  } else {
    // 表格格式
    console.log('\n┌──────────┬────────────────────────────────────┬─────────────────┬──────┬────────────────┐');
    console.log('│    ID    │              标题                  │      作者       │ 年份 │      类型      │');
    console.log('├──────────┼────────────────────────────────────┼─────────────────┼──────┼────────────────┤');
    
    mockItems.forEach(item => {
      const id = item.id.padEnd(8);
      const title = (item.title.length > 30 ? item.title.substring(0, 27) + '...' : item.title).padEnd(36);
      const authors = (item.authors.length > 2 ? item.authors.slice(0, 2).join(', ') + '...' : item.authors.join(', ')).padEnd(15);
      const year = item.year.padEnd(4);
      const type = item.type.padEnd(14);
      
      console.log(`│ ${id} │ ${title} │ ${authors} │ ${year} │ ${type} │`);
    });
    
    console.log('└──────────┴────────────────────────────────────┴─────────────────┴──────┴────────────────┘');
  }
  
  console.log(`\n📈 总共找到 125 个项目，显示 ${Math.min(mockItems.length, limit)} 个`);
}