import chalk from 'chalk';
import figures from 'figures';

export const symbols = {
  success: chalk.green(figures.tick),    // ✔
  error: chalk.red(figures.cross),        // ✘
  warning: chalk.yellow(figures.warning),  // ⚠
  pending: process.platform === 'darwin' ? '⏺' : '●',
} as const;
