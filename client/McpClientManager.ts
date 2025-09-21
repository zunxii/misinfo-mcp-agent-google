import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { McpClient, McpServerConfig } from "./McpClient";

export class McpClientManager {
  private clients: Map<string, McpClient> = new Map();
  private configs: Map<string, McpServerConfig> = new Map();

  constructor(private defaultTimeout: number = 30000) {}

  addServer(config: McpServerConfig): void {
    this.configs.set(config.name, config);
    console.log(`Added MCP server config: ${config.name}`);
  }

  async connectAll(): Promise<void> {
    const connectionPromises = Array.from(this.configs.entries()).map(
      async ([name, config]) => {
        try {
          const client = new McpClient(name, config.timeout || this.defaultTimeout);
          await client.connect(config.command, config.args, config.env);
          this.clients.set(name, client);
          console.log(`✓ Connected to ${name}`);
        } catch (error) {
          console.error(`✗ Failed to connect to ${name}:`, error);
        }
      }
    );

    await Promise.allSettled(connectionPromises);
    
    const connectedCount = this.clients.size;
    const totalCount = this.configs.size;
    console.log(`Connected to ${connectedCount}/${totalCount} MCP servers`);
  }

  async connectServer(name: string): Promise<void> {
    const config = this.configs.get(name);
    if (!config) {
      throw new Error(`No configuration found for server: ${name}`);
    }

    const existingClient = this.clients.get(name);
    if (existingClient) {
      await existingClient.close();
    }

    const client = new McpClient(name, config.timeout || this.defaultTimeout);
    await client.connect(config.command, config.args, config.env);
    this.clients.set(name, client);
  }

  getClient(name: string): McpClient | undefined {
    return this.clients.get(name);
  }

  async callTool(serverName: string, toolName: string, args: any = {}): Promise<any> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP client ${serverName} not found or not connected`);
    }

    return await client.callTool(toolName, args);
  }

  async healthCheck(): Promise<{ [serverName: string]: boolean }> {
    const results: { [serverName: string]: boolean } = {};
    
    const healthPromises = Array.from(this.clients.entries()).map(
      async ([name, client]) => {
        const isHealthy = await client.ping();
        results[name] = isHealthy;
        return { name, isHealthy };
      }
    );

    await Promise.allSettled(healthPromises);
    return results;
  }

  async reconnectServer(name: string): Promise<void> {
    const config = this.configs.get(name);
    const client = this.clients.get(name);
    
    if (!config) {
      throw new Error(`No configuration found for server: ${name}`);
    }

    if (client) {
      await client.reconnect(config.command, config.args, config.env);
    } else {
      await this.connectServer(name);
    }
  }

  listConnectedServers(): string[] {
    return Array.from(this.clients.keys()).filter(name => 
      this.clients.get(name)?.connected
    );
  }

  listAllServers(): string[] {
    return Array.from(this.configs.keys());
  }

  async getAllTools(): Promise<{ [serverName: string]: Tool[] }> {
    const allTools: { [serverName: string]: Tool[] } = {};
    
    for (const [name, client] of this.clients) {
      if (client.connected) {
        try {
          allTools[name] = await client.listTools();
        } catch (error) {
          console.warn(`Failed to get tools from ${name}:`, error);
          allTools[name] = [];
        }
      }
    }
    
    return allTools;
  }

  async closeAll(): Promise<void> {
    console.log('Closing all MCP clients...');
    
    const closePromises = Array.from(this.clients.values()).map(client => 
      client.close().catch(error => 
        console.error(`Error closing client ${client.name}:`, error)
      )
    );
    
    await Promise.allSettled(closePromises);
    this.clients.clear();
    
    console.log('All MCP clients closed');
  }

  static createStandardConfig(): McpClientManager {
    const manager = new McpClientManager();
    
    manager.addServer({
      name: 'factcheck',
      command: 'node',
      args: ['dist/servers/factcheck/server.js'],
      env: {
        GOOGLE_FACTCHECK_API_KEY: process.env.GOOGLE_FACTCHECK_API_KEY!,
        SIGNING_SECRET: process.env.SIGNING_SECRET!,
      },
    });
    
    manager.addServer({
      name: 'video-forensics',
      command: 'node', 
      args: ['dist/servers/video-forensics/server.js'],
      env: {
        TEMP_DIR: process.env.TEMP_DIR || '/tmp/video-forensics',
        GOOGLE_VISION_API_KEY: process.env.GOOGLE_VISION_API_KEY!,
      },
    });
    
    manager.addServer({
      name: 'web-fetch',
      command: 'node',
      args: ['dist/servers/web-fetch/server.js'],
      env: {
        USER_AGENT: 'FactCheck-Bot/1.0',
      },
    });

    return manager;
  }
}