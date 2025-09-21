import fetch, { RequestInit } from 'node-fetch';
import { JSDOM } from 'jsdom';

export class WebScraperService {
  constructor(private userAgent: string) {}

  async fetchPage(url: string, timeoutMs: number = 30000): Promise<{
    html: string;
    statusCode: number;
    headers: any;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const options: RequestInit = {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
        },
        signal: controller.signal,
        follow: 5,
      };

      const response = await fetch(url, options);
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      return {
        html,
        statusCode: response.status,
        headers: response.headers.raw(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  extractMetadata(html: string, url: string): any {
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;

    return {
      title: document.querySelector('title')?.textContent?.trim(),
      description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
      keywords: document.querySelector('meta[name="keywords"]')?.getAttribute('content')?.split(',').map(k => k.trim()),
      author: document.querySelector('meta[name="author"]')?.getAttribute('content'),
      canonicalUrl: document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
      publishDate: this.extractPublishDate(document),
    };
  }

  private extractPublishDate(document: Document): string | null {
    const dateSelectors = [
      'meta[property="article:published_time"]',
      'meta[property="og:pubdate"]',
      'meta[name="publishdate"]',
      'time[pubdate]',
      'time[datetime]',
    ];

    for (const selector of dateSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        const dateStr = element.getAttribute('content') || 
                       element.getAttribute('datetime') || 
                       element.textContent;
        
        if (dateStr) {
          try {
            const date = new Date(dateStr.trim());
            if (!isNaN(date.getTime())) {
              return date.toISOString();
            }
          } catch (error) {
            continue;
          }
        }
      }
    }

    return null;
  }
}
