import { Command } from 'commander';

export function configureUpdate(program: Command) {
  const updateCommand = program
    .command('update')
    .description('更新 Zotero 库中的文献')
    .argument('<key>', '文献 Key')
    .argument('<field>', '要更新的字段 (title, date, abstract, url, doi)')
    .argument('<value>', '新的值')
    .option('-m, --multi', '允许多值字段 (如 tags)')
    .action(async (key, field, value, options) => {
      await performUpdate({ key, field, value, ...options });
    });
  
  return updateCommand;
}

interface UpdateOptions {
  key: string;
  field: string;
  value: string;
  multi?: boolean;
}

export async function performUpdate(options: UpdateOptions) {
  console.log('📝 更新文献...\n');
  
  const { key, field, value } = options;
  
  console.log(`   Key: ${key}`);
  console.log(`   字段: ${field}`);
  console.log(`   新值: ${value}`);
  
  console.log('\n💡 注意：此功能需要完整的 Zotero API 写入权限');
  console.log('   当前为模拟模式，请通过 Zotero 网页版编辑文献');
}
