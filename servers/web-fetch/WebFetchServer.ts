import { BaseServer } from '../../base/BaseServer';
import { Tool, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { WebFetchResult, SearchResult } from '../../types/web-fetch.types';
import { WebScraperService } from '../../services/web-scraper.service';
import { CryptoUtils } from '../../utils/crypto.utils';

export class WebFetchServer extends BaseServer {
  protected serverName = "web-fetch-mcp";
  protected serverVersion = "1.0.0";
  protected serverDescription = "MCP server for web content fetching and search";
  
  private scraperService: WebScraperService;

  constructor() {
    super("web-fetch-mcp", "1.0.0", "MCP server for web content fetching and search");
    const userAgent = process.env.USER_AGENT || 'FactCheck-Bot/1.0';
    this.scraperService = new WebScraperService(userAgent);
  }

  protected getTools(): Tool[] {
    return [
      {
        name: "fetch_url",
        description: "Fetch content from a URL with metadata extraction",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The URL to fetch",
            },
            include_screenshots: {
              type: "boolean",
              description: "Whether to capture screenshots",
              default: false,
            },
            extract_links: {
              type: "boolean", 
              description: "Whether to extract all links from the page",
              default: true,
            },
            timeout: {
              type: "number",
              description: "Request timeout in milliseconds",
              default: 30000,
            },
          },
          required: ["url"],
        },
      },
      {
        name: "search",
        description: "Search the web for content related to a query",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query",
            },
            max_results: {
              type: "number",
              description: "Maximum number of results to return",
              default: 10,
            },
          },
          required: ["query"],
        },
      },
    ];
  }

  protected async handleToolCall(name: string, args: any): Promise<{ content: any[] }> {
    switch (name) {
      case "fetch_url":
        return await this.handleFetchUrl(args);
      case "search":
        return await this.handleSearch(args);
      default:
        this.throwMcpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  }

  private async handleFetchUrl(args: any): Promise<{ content: WebFetchResult[] }> {
    const { url, timeout = 30000 } = args;

    if (!url || typeof url !== 'string') {
      this.throwMcpError(ErrorCode.InvalidParams, "URL is required and must be a string");
    }

    try {
      const { html, statusCode, headers } = await this.scraperService.fetchPage(url, timeout);
      const metadata = this.scraperService.extractMetadata(html, url);
      
      const result: WebFetchResult = {
        url,
        title: metadata.title,
        content: html,
        metadata: {
          statusCode,
          ...metadata,
        },
        contentHash: CryptoUtils.computeSha256(html),
        links: [],
        firstAppearanceHints: {},
      };

      return { content: [result] };
    } catch (error) {
      this.throwMcpError(
        ErrorCode.InternalError,
        `Failed to fetch URL: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleSearch(args: any): Promise<{ content: SearchResult[] }> {
    const { query, max_results = 10 } = args;

    if (!query || typeof query !== 'string') {
      this.throwMcpError(ErrorCode.InvalidParams, "Query is required and must be a string");
    }

    try {
      // Mock implementation
      const result: SearchResult = {
        query,
        results: [],
        totalResults: 0,
        searchTime: Date.now(),
      };

      return { content: [result] };
    } catch (error) {
      this.throwMcpError(
        ErrorCode.InternalError,
        `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
