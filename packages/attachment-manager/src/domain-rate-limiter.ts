// Per-domain rate limiting for HTTP requests
// Adapted from Zotero Desktop attachments.js:1493-1508, 1656-1753

interface DomainInfo {
  nextRequestTime: number;
  consecutiveFailures: number;
}

// Domains that skip rate limiting delays
const SKIP_DELAY_DOMAINS = ['doi.org', 'localhost'];

export class DomainRateLimiter {
  private domains = new Map<string, DomainInfo>();

  constructor(
    private delay: number = 1000,
    private maxFailures: number = 5,
  ) {}

  /**
   * Extract the domain from a URL string.
   */
  static extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  private getDomainInfo(domain: string): DomainInfo {
    let info = this.domains.get(domain);
    if (!info) {
      info = { nextRequestTime: 0, consecutiveFailures: 0 };
      this.domains.set(domain, info);
    }
    return info;
  }

  /**
   * Wait until the domain is available for a request.
   * Skips delay for doi.org and localhost.
   * Throws if domain has exceeded max consecutive failures.
   */
  async waitForDomain(url: string): Promise<void> {
    const domain = DomainRateLimiter.extractDomain(url);

    if (SKIP_DELAY_DOMAINS.includes(domain)) {
      return;
    }

    const info = this.getDomainInfo(domain);

    if (info.consecutiveFailures >= this.maxFailures) {
      throw new Error(`Too many consecutive failures for ${domain} (${info.consecutiveFailures})`);
    }

    const now = Date.now();
    if (info.nextRequestTime > now) {
      const waitMs = info.nextRequestTime - now;
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }

    // Set next allowed request time
    info.nextRequestTime = Date.now() + this.delay;
  }

  /**
   * Record a successful request — resets consecutive failure count.
   */
  recordSuccess(url: string): void {
    const domain = DomainRateLimiter.extractDomain(url);
    if (SKIP_DELAY_DOMAINS.includes(domain)) return;
    const info = this.getDomainInfo(domain);
    info.consecutiveFailures = 0;
  }

  /**
   * Record a failed request — increments consecutive failure count.
   * Returns true if we should retry (haven't exceeded max failures).
   */
  recordFailure(url: string): boolean {
    const domain = DomainRateLimiter.extractDomain(url);
    if (SKIP_DELAY_DOMAINS.includes(domain)) return true;
    const info = this.getDomainInfo(domain);
    info.consecutiveFailures++;
    return info.consecutiveFailures < this.maxFailures;
  }

  /**
   * Handle a Retry-After header value (from 429 or 503 responses).
   * Updates the domain's nextRequestTime accordingly.
   * Returns true if the retry-after is acceptable (< 1 hour), false otherwise.
   */
  handleRetryAfter(url: string, retryAfterHeader: string): boolean {
    const domain = DomainRateLimiter.extractDomain(url);
    const info = this.getDomainInfo(domain);
    const maxDelay = 3600; // 1 hour max

    // Try parsing as integer (seconds)
    const seconds = parseInt(retryAfterHeader, 10);
    if (!isNaN(seconds) && String(seconds) === retryAfterHeader.trim()) {
      if (seconds > maxDelay) return false;
      info.nextRequestTime = Date.now() + seconds * 1000;
      return true;
    }

    // Try parsing as HTTP date
    const date = new Date(retryAfterHeader);
    if (!isNaN(date.getTime())) {
      if (date.getTime() > Date.now() + maxDelay * 1000) return false;
      info.nextRequestTime = date.getTime();
      return true;
    }

    return false;
  }

  /**
   * Check if a domain has exceeded its failure limit.
   */
  isDomainBlocked(url: string): boolean {
    const domain = DomainRateLimiter.extractDomain(url);
    const info = this.domains.get(domain);
    return !!info && info.consecutiveFailures >= this.maxFailures;
  }

  /**
   * Reset all domain tracking state.
   */
  reset(): void {
    this.domains.clear();
  }
}
