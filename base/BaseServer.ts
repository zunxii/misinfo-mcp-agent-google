import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  Tool, 
} from "@modelcontextprotocol/sdk/types.js";

export abstract class BaseServer {
  protected server: Server;

  constructor(
    protected readonly serverName: string,
    protected readonly serverVersion: string,
    protected readonly serverDescription: string
  ) {
    this.server = new Server(
      {
        name: serverName,
        version: serverVersion,
        description: serverDescription,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
    this.setupHandlers();
  }

  protected abstract getTools(): Tool[];
  protected abstract handleToolCall(name: string, args: any): Promise<{ content: any[] }>;

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return await this.handleToolCall(request.params.name, request.params.arguments);
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`${this.serverName} MCP server running on stdio`);
  }

  protected throwMcpError(code: ErrorCode, message: string): never {
    throw new McpError(code, message);
  }
}
