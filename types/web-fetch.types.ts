export interface WebFetchResult {
  url: string;
  title?: string;
  content: string;
  metadata: {
    statusCode: number;
    contentType?: string;
    contentLength?: number;
    lastModified?: string;
    canonicalUrl?: string;
    description?: string;
    keywords?: string[];
    author?: string;
    publishDate?: string;
  };
  contentHash: string;
  screenshots?: string[];
  links: Array<{
    url: string;
    text: string;
    type: 'internal' | 'external';
  }>;
  firstAppearanceHints: {
    waybackMachine?: string;
    indexDate?: string;
    socialShares?: number;
  };
}

export interface SearchResult {
  query: string;
  results: Array<{
    url: string;
    title: string;
    snippet: string;
    relevanceScore: number;
    publishDate?: string;
    source: string;
  }>;
  totalResults: number;
  searchTime: number;
}