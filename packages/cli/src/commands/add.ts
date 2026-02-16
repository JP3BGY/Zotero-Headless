import { Command } from 'commander';

export function configureAdd(program: Command) {
  const addCommand = program
    .command('add')
    .description('添加新文献到 Zotero 库')
    .argument('<type>', '文献类型 (journalArticle, book, webpage 等)')
    .argument('<title>', '文献标题')
    .argument('[authors...]', '作者列表')
    .option('-d, --doi <doi>', 'DOI')
    .option('-u, --url <url>', 'URL')
    .option('-a, --abstract <abstract>', '摘要')
    .option('--year <year>', '出版年份')
    .action(async (type, title, authors, options) => {
      await performAdd({ type, title, authors, ...options });
    });
  
  return addCommand;
}

interface AddOptions {
  type: string;
  title: string;
  authors?: string[];
  doi?: string;
  url?: string;
  abstract?: string;
  year?: string;
}

export async function performAdd(options: AddOptions) {
  console.log('📝 添加新文献...\n');
  
  const { type, title, authors = [], doi, url, abstract, year } = options;
  
  console.log(`   类型: ${type}`);
  console.log(`   标题: ${title}`);
  
  if (authors.length > 0) {
    console.log(`   作者: ${authors.join(', ')}`);
  }
  
  if (doi) console.log(`   DOI: ${doi}`);
  if (url) console.log(`   URL: ${url}`);
  if (year) console.log(`   年份: ${year}`);
  
  console.log('\n💡 注意：此功能需要完整的 Zotero API 写入权限');
  console.log('   当前为模拟模式，请通过 Zotero 网页版添加文献');
}
