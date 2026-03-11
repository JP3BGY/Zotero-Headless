import chalk from 'chalk';

export const symbols = {
  success: chalk.green('✔'),
  error: chalk.red('✘'),
  warning: chalk.yellow('!'),
  pending: chalk.gray('◼'),
} as const;
