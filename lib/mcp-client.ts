// lib/mcp-client.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, ChildProcess } from 'child_process';
import {
  CallToolRequest,
  ListToolsRequest,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  timeout?: number;
}

export class McpClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private serverProcess: ChildProcess | null = null;
  private isConnected: boolean = false;
  private availableTools: Tool[] = [];
  private connectionTimeout: number;

  constructor(
    private serverName: string,
    timeout: number = 30000
  ) {
    this.connectionTimeout = timeout;
    this.client = new Client({
      name: `factcheck-client-${serverName}`,
      version: "1.0.0",
    }, {
      capabilities: {}
    });
  }

  async connect(command: string, args: string[] = [], env?: Record<string, string>): Promise<void> {
    if (this.isConnected) {
      console.warn(`MCP client ${this.serverName} is already connected`);
      return;
    }

    try {
      console.log(`Connecting to MCP server ${this.serverName}: ${command} ${args.join(' ')}`);

      // Start the server process
      const processEnv = {
        ...process.env,
        ...env,
      };

      this.serverProcess = spawn(command, args, {
        env: processEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (!this.serverProcess.stdin || !this.serverProcess.stdout) {
        throw new Error('Failed to create stdio streams for server process');
      }

      // Handle process errors
      this.serverProcess.on('error', (error) => {
        console.error(`Server process error for ${this.serverName}:`, error);
        this.handleDisconnection();
      });

      this.serverProcess.on('exit', (code, signal) => {
        console.log(`Server process ${this.serverName} exited with code ${code}, signal ${signal}`);
        this.handleDisconnection();
      });

      // Log stderr for debugging
      this.serverProcess.stderr?.on('data', (data) => {
        console.error(`${this.serverName} stderr:`, data.toString());
      });

      // Create transport and connect
      this.transport = new StdioClientTransport({
        stdin: this.serverProcess.stdin,
        stdout: this.serverProcess.stdout,
      });

      // Set up connection timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Connection timeout after ${this.connectionTimeout}ms`));
        }, this.connectionTimeout);
      });

      const connectPromise = this.client.connect(this.transport);

      await Promise.race([connectPromise, timeoutPromise]);

      this.isConnected = true;
      console.log(`Successfully connected to MCP server ${this.serverName}`);

      // Load available tools
      await this.loadAvailableTools();

    } catch (error) {
      console.error(`Failed to connect to MCP server ${this.serverName}:`, error);
      await this.cleanup();
      throw error;
    }
  }

  private async loadAvailableTools(): Promise<void> {
    try {
      const response = await this.client.request(
        { method: "tools/list" },
        ListToolsRequest
      );

      this.availableTools = response.tools;
      console.log(`Loaded ${this.availableTools.length} tools from ${this.serverName}:`, 
        this.availableTools.map(t => t.name).join(', '));

    } catch (error) {
      console.warn(`Failed to load tools from ${this.serverName}:`, error);
      this.availableTools = [];
    }
  }

  async callTool(toolName: string, arguments_: any = {}): Promise<any> {
    if (!this.isConnected) {
      throw new Error(`MCP client ${this.serverName} is not connected`);
    }

    // Check if tool is available
    const tool = this.availableTools.find(t => t.name === toolName);
    if (!tool) {
      const availableToolNames = this.availableTools.map(t => t.name);
      throw new Error(`Tool ${toolName} not found in ${this.serverName}. Available tools: ${availableToolNames.join(', ')}`);
    }

    try {
      console.log(`Calling tool ${toolName} on ${this.serverName} with args:`, arguments_);

      const response = await this.client.request(
        {
          method: "tools/call",
          params: {
            name: toolName,
            arguments: arguments_,
          },
        },
        CallToolRequest
      );

      if (response.isError) {
        throw new Error(`Tool call error: ${response.content[0]?.text || 'Unknown error'}`);
      }

      // Handle different content types
      let result: any;
      if (response.content.length === 1 && response.content[0].type === 'text') {
        // Try to parse JSON response
        try {
          result = JSON.parse(response.content[0].text);
        } catch {
          result = response.content[0].text;
        }
      } else {
        result = response.content;
      }

      console.log(`Tool ${toolName} completed successfully`);
      return result;

    } catch (error) {
      console.error(`Tool call failed for ${toolName} on ${this.serverName}:`, error);
      
      // Check if connection is still alive
      if (this.serverProcess?.killed || !this.isConnected) {
        console.warn(`Server ${this.serverName} appears to be disconnected`);
        this.handleDisconnection();
      }
      
      throw error;
    }
  }

  async listTools(): Promise<Tool[]> {
    if (!this.isConnected) {
      throw new Error(`MCP client ${this.serverName} is not connected`);
    }

    return [...this.availableTools];
  }

  async ping(): Promise<boolean> {
    if (!this.isConnected || !this.serverProcess) {
      return false;
    }

    try {
      // Try to list tools as a health check
      await this.client.request({ method: "tools/list" }, ListToolsRequest);
      return true;
    } catch (error) {
      console.warn(`Ping failed for ${this.serverName}:`, error);
      return false;
    }
  }

  async reconnect(command: string, args: string[] = [], env?: Record<string, string>): Promise<void> {
    console.log(`Attempting to reconnect to ${this.serverName}...`);
    
    await this.close();
    
    // Wait a bit before reconnecting
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await this.connect(command, args, env);
  }

  private handleDisconnection(): void {
    if (this.isConnected) {
      console.log(`MCP server ${this.serverName} disconnected`);
      this.isConnected = false;
    }
  }

  private async cleanup(): Promise<void> {
    this.isConnected = false;

    if (this.serverProcess && !this.serverProcess.killed) {
      console.log(`Terminating server process for ${this.serverName}`);
      
      // Try graceful shutdown first
      this.serverProcess.kill('SIGTERM');
      
      // Force kill after timeout
      setTimeout(() => {
        if (this.serverProcess && !this.serverProcess.killed) {
          console.log(`Force killing server process for ${this.serverName}`);
          this.serverProcess.kill('SIGKILL');
        }
      }, 5000);
    }

    this.serverProcess = null;
    this.transport = null;
  }

  async close(): Promise<void> {
    console.log(`Closing MCP client ${this.serverName}`);
    
    try {
      if (this.transport && this.isConnected) {
        await this.client.close();
      }
    } catch (error) {
      console.warn(`Error during client close for ${this.serverName}:`, error);
    } finally {
      await this.cleanup();
    }
  }

  // Getters
  get connected(): boolean {
    return this.isConnected;
  }

  get name(): string {
    return this.serverName;
  }

  get tools(): Tool[] {
    return [...this.availableTools];
  }
}

// Utility class for managing multiple MCP clients
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
          // Don't throw - allow other connections to proceed
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

  // Factory method for common server configurations
  static createStandardConfig(): McpClientManager {
    const manager = new McpClientManager();
    
    // Add standard MCP server configurations
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