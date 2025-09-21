import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, ChildProcess } from 'child_process';
import { Tool } from "@modelcontextprotocol/sdk/types.js";

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

      this.serverProcess.on('error', (error) => {
        console.error(`Server process error for ${this.serverName}:`, error);
        this.handleDisconnection();
      });

      this.serverProcess.on('exit', (code, signal) => {
        console.log(`Server process ${this.serverName} exited with code ${code}, signal ${signal}`);
        this.handleDisconnection();
      });

      this.serverProcess.stderr?.on('data', (data) => {
        console.error(`${this.serverName} stderr:`, data.toString());
      });

      // Create transport with correct parameters
      this.transport = new StdioClientTransport({
        // Use the child process stdio streams
        inputStream: this.serverProcess.stdout,
        outputStream: this.serverProcess.stdin,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Connection timeout after ${this.connectionTimeout}ms`));
        }, this.connectionTimeout);
      });

      const connectPromise = this.client.connect(this.transport);

      await Promise.race([connectPromise, timeoutPromise]);

      this.isConnected = true;
      console.log(`Successfully connected to MCP server ${this.serverName}`);

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
        {} // Empty params object instead of schema
      );

      this.availableTools = (response as any).tools || [];
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
        {} // Empty params object
      );

      const typedResponse = response as any;

      if (typedResponse.isError) {
        throw new Error(`Tool call error: ${typedResponse.content?.[0]?.text || 'Unknown error'}`);
      }

      let result: any;
      if (typedResponse.content?.length === 1 && typedResponse.content[0].type === 'text') {
        try {
          result = JSON.parse(typedResponse.content[0].text);
        } catch {
          result = typedResponse.content[0].text;
        }
      } else {
        result = typedResponse.content;
      }

      console.log(`Tool ${toolName} completed successfully`);
      return result;

    } catch (error) {
      console.error(`Tool call failed for ${toolName} on ${this.serverName}:`, error);
      
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
      await this.client.request({ method: "tools/list" }, {});
      return true;
    } catch (error) {
      console.warn(`Ping failed for ${this.serverName}:`, error);
      return false;
    }
  }

  async reconnect(command: string, args: string[] = [], env?: Record<string, string>): Promise<void> {
    console.log(`Attempting to reconnect to ${this.serverName}...`);
    
    await this.close();
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
      
      this.serverProcess.kill('SIGTERM');
      
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
