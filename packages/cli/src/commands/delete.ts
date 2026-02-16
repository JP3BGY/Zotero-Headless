import { Command } from 'commander';

export function configureDelete(program: Command) {
  const deleteCommand = program
    .command('delete')
    .description('删除 (移至回收站) 或永久删除 Zotero 文献')
    .argument('<key>', '文献 Key')
    .option('-p, --permanent', '永久删除（不可恢复）')
    .option('-t, --trash', '移至回收站（默认）')
    .action(async (key, options) => {
      await performDelete({ key, ...options });
    });
  
  return deleteCommand;
}

interface DeleteOptions {
  key: string;
  permanent?: boolean;
  trash?: boolean;
}

export async function performDelete(options: DeleteOptions) {
  console.log('🗑️  删除文献...\n');
  
  const { key, permanent = false } = options;
  
  console.log(`   Key: ${key}`);
  
  if (permanent) {
    console.log('   模式: 永久删除 ⚠️');
  } else {
    console.log('   模式: 移至回收站');
  }
  
  console.log('\n💡 注意：此功能需要完整的 Zotero API 写入权限');
  console.log('   当前为模拟模式，请通过 Zotero 网页版删除文献');
}
