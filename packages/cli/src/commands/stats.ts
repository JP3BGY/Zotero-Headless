import { Command } from 'commander';

export function configureStats(program: Command) {
  const statsCommand = program
    .command('stats')
    .description('显示文献库统计信息')
    .option('-d, --detailed', '显示详细统计')
    .option('--format <format>', '输出格式 (json, table, summary)', 'summary')
    .option('--since <date>', '从指定日期开始的统计')
    .action(async (options) => {
      await performStats(options);
    });
  
  return statsCommand;
}

export async function performStats(options: {
  detailed?: boolean;
  format?: string;
  since?: string;
}) {
  console.log('📊 Zotero 文献库统计');
  
  if (options.since) {
    console.log(`📅 时间范围：${options.since} 至今`);
  }
  
  // 模拟统计信息
  const stats = {
    totalItems: 327,
    totalCollections: 15,
    totalTags: 243,
    byType: {
      journalArticle: 156,
      book: 42,
      conferencePaper: 65,
      thesis: 18,
      report: 25,
      other: 21
    },
    byYear: {
      '2020-2024': 189,
      '2015-2019': 102,
      '2010-2014': 28,
      '2005-2009': 8
    },
    topAuthors: ['王伟', '李明', '张强', '刘芳', '陈静'],
    topTags: ['机器学习', '人工智能', '深度学习', '数据分析', '算法'],
    totalNotes: 87,
    totalAttachments: 143,
    lastSync: new Date().toISOString().split('T')[0],
    databaseSize: '2.3MB'
  };
  
  if (options.format === 'json') {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  
  console.log(`\n📈 总体统计：`);
  console.log(`   • 文献总数：${stats.totalItems} 项`);
  console.log(`   • 收藏夹数：${stats.totalCollections} 个`);
  console.log(`   • 标签数量：${stats.totalTags} 个`);
  console.log(`   • 附件数量：${stats.totalAttachments} 个`);
  console.log(`   • 笔记数量：${stats.totalNotes} 条`);
  console.log(`   • 数据库大小：${stats.databaseSize}`);
  console.log(`   • 最后同步：${stats.lastSync}`);
  
  if (options.detailed || options.format === 'table') {
    console.log(`\n📂 按类型分布：`);
    console.log('┌──────────────────┬───────┬──────────┐');
    console.log('│       类型       │ 数量  │   比例   │');
    console.log('├──────────────────┼───────┼──────────┤');
    
    Object.entries(stats.byType).forEach(([type, count]) => {
      const typeName = type.padEnd(16);
      const countStr = count.toString().padEnd(5);
      const percentage = ((count / stats.totalItems) * 100).toFixed(1);
      const percentageStr = `${percentage}%`.padEnd(8);
      
      console.log(`│ ${typeName} │ ${countStr} │ ${percentageStr} │`);
    });
    
    console.log('└──────────────────┴───────┴──────────┘');
    
    console.log(`\n📅 按年份分布：`);
    console.log('┌──────────────┬───────┬──────────┐');
    console.log('│     年份     │ 数量  │   比例   │');
    console.log('├──────────────┼───────┼──────────┤');
    
    Object.entries(stats.byYear).forEach(([range, count]) => {
      const rangeName = range.padEnd(12);
      const countStr = count.toString().padEnd(5);
      const percentage = ((count / stats.totalItems) * 100).toFixed(1);
      const percentageStr = `${percentage}%`.padEnd(8);
      
      console.log(`│ ${rangeName} │ ${countStr} │ ${percentageStr} │`);
    });
    
    console.log('└──────────────┴───────┴──────────┘');
  }
  
  if (options.detailed) {
    console.log(`\n👤 最常出现的作者（前5）：`);
    stats.topAuthors.forEach((author, index) => {
      console.log(`   ${index + 1}. ${author}`);
    });
    
    console.log(`\n🏷️  最常用的标签（前5）：`);
    stats.topTags.forEach((tag, index) => {
      console.log(`   ${index + 1}. #${tag}`);
    });
  }
  
  console.log('\n💡 提示：使用 --detailed 查看更详细的信息');
}