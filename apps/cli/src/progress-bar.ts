// ProgressBar utility for CLI
// Displays real-time progress with ANSI escape sequences

export interface ProgressBarOptions {
  total: number;
  width?: number;
  label?: string;
}

export class ProgressBar {
  private total: number;
  private current: number = 0;
  private width: number;
  private label: string;
  private startTime: number;

  constructor(options: ProgressBarOptions) {
    this.total = options.total;
    this.width = options.width || 40;
    this.label = options.label || '';
    this.startTime = Date.now();
  }

  /**
   * Update progress
   */
  update(current: number, label?: string): void {
    // Clamp current to valid range [0, total]
    this.current = Math.max(0, Math.min(current, this.total));
    if (label) this.label = label;
    this.render();
  }

  /**
   * Increment by one
   */
  increment(label?: string): void {
    this.update(this.current + 1, label);
  }

  /**
   * Render the progress bar
   */
  private render(): void {
    const percentage = this.total > 0 ? Math.floor((this.current / this.total) * 100) : 0;
    const filled = Math.floor((this.current / this.total) * this.width);
    const empty = this.width - filled;

    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const labelStr = this.label ? ` ${this.label}` : '';

    // ANSI escape: \r moves cursor to start of line, \x1b[K clears to end
    const output = `\r\x1b[K[${bar}] ${percentage}% (${this.current}/${this.total})${labelStr} [${elapsed}s]`;
    
    process.stdout.write(output);
  }

  /**
   * Complete the progress bar
   */
  complete(message?: string): void {
    this.update(this.total);
    process.stdout.write('\n');
    if (message) {
      console.log(message);
    }
  }

  /**
   * Stop without completing
   */
  stop(): void {
    process.stdout.write('\n');
  }
}
