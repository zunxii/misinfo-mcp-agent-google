// app/api/agent/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { InvestigationOrchestrator, InvestigationRequest } from '../../../lib/orchestrator.js';
import { McpClientManager } from '../../../lib/mcp-client.js';

// Global orchestrator instance (in production, use proper dependency injection)
let orchestrator: InvestigationOrchestrator | null = null;
let clientManager: McpClientManager | null = null;

async function initializeOrchestrator(): Promise<InvestigationOrchestrator> {
  if (orchestrator) {
    return orchestrator;
  }

  console.log('Initializing MCP orchestrator...');

  // Create and configure MCP client manager
  clientManager = new McpClientManager(30000);
  
  // Add MCP server configurations
  clientManager.addServer({
    name: 'factcheck',
    command: 'node',
    args: [process.cwd() + '/dist/servers/factcheck/server.js'],
    env: {
      GOOGLE_FACTCHECK_API_KEY: process.env.GOOGLE_FACTCHECK_API_KEY || '',
      SIGNING_SECRET: process.env.SIGNING_SECRET || 'dev-secret-key',
    },
    timeout: 30000,
  });

  clientManager.addServer({
    name: 'video-forensics',
    command: 'node',
    args: [process.cwd() + '/dist/servers/video-forensics/server.js'],
    env: {
      TEMP_DIR: process.env.TEMP_DIR || '/tmp/video-forensics',
      GOOGLE_VISION_API_KEY: process.env.GOOGLE_VISION_API_KEY || '',
    },
    timeout: 60000, // Longer timeout for video processing
  });

  clientManager.addServer({
    name: 'web-fetch',
    command: 'node',
    args: [process.cwd() + '/dist/servers/web-fetch/server.js'],
    env: {
      USER_AGENT: 'FactCheck-Bot/1.0 (+https://factcheck-platform.example.com)',
    },
    timeout: 30000,
  });

  // Connect to all servers
  try {
    await clientManager.connectAll();
    console.log('MCP servers connected successfully');
  } catch (error) {
    console.error('Failed to connect to some MCP servers:', error);
    // Continue anyway - some servers may still be available
  }

  // Create orchestrator with MCP clients
  orchestrator = new InvestigationOrchestrator([
    // These will be replaced by the client manager approach
  ]);

  // Override the clients with our manager's clients
  const connectedClients = clientManager.listConnectedServers();
  console.log('Available MCP servers:', connectedClients);

  return orchestrator;
}

// Health check endpoint
async function handleHealthCheck(): Promise<NextResponse> {
  try {
    if (!clientManager) {
      return NextResponse.json({
        status: 'initializing',
        message: 'MCP client manager not initialized',
      }, { status: 503 });
    }

    const healthStatus = await clientManager.healthCheck();
    const connectedServers = clientManager.listConnectedServers();
    
    return NextResponse.json({
      status: 'healthy',
      servers: healthStatus,
      connected_count: connectedServers.length,
      available_tools: await clientManager.getAllTools(),
    });
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

// Main investigation endpoint
async function handleInvestigation(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    
    // Validate request
    if (!body.type || !body.content) {
      return NextResponse.json({
        error: 'Invalid request: type and content are required',
        example: {
          type: 'fact_check',
          content: {
            claim: 'The earth is flat',
            context: 'Seen on social media'
          },
          options: {
            include_forensics: true,
            generate_lesson: true,
            create_timeline: true
          }
        }
      }, { status: 400 });
    }

    // Initialize orchestrator if needed
    const orch = await initializeOrchestrator();

    // Prepare investigation request
    const investigationRequest: InvestigationRequest = {
      type: body.type,
      content: body.content,
      options: {
        include_forensics: body.options?.include_forensics ?? true,
        generate_lesson: body.options?.generate_lesson ?? true,
        create_timeline: body.options?.create_timeline ?? true,
      },
    };

    console.log('Starting investigation:', {
      type: investigationRequest.type,
      content_keys: Object.keys(investigationRequest.content),
    });

    // Perform investigation
    const startTime = Date.now();
    const result = await orch.investigate(investigationRequest);
    const processingTime = Date.now() - startTime;

    console.log(`Investigation completed in ${processingTime}ms:`, {
      id: result.id,
      verdict: result.verdict,
      confidence: result.confidence,
      evidence_count: result.evidence_chain.length,
    });

    // Return result
    return NextResponse.json({
      ...result,
      processing_time_ms: processingTime,
      api_version: '1.0.0',
    });

  } catch (error) {
    console.error('Investigation failed:', error);
    
    return NextResponse.json({
      error: 'Investigation failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}

// Export investigation endpoint
async function handleExport(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const investigationId = searchParams.get('id');

    if (!investigationId) {
      return NextResponse.json({
        error: 'Investigation ID is required'
      }, { status: 400 });
    }

    const orch = await initializeOrchestrator();
    const exportData = await orch.exportInvestigation(investigationId);

    // Set appropriate headers for download
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="investigation-${investigationId}.json"`,
    });

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers,
    });

  } catch (error) {
    return NextResponse.json({
      error: 'Export failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

// List investigations endpoint
async function handleList(): Promise<NextResponse> {
  try {
    const orch = await initializeOrchestrator();
    const investigations = await orch.listInvestigations();

    // Get summary info for each investigation
    const summaries = await Promise.all(
      investigations.map(async (id) => {
        const inv = await orch.getInvestigation(id);
        return inv ? {
          id,
          verdict: inv.verdict,
          confidence: inv.confidence,
          evidence_count: inv.evidence_chain.length,
          techniques_detected: inv.techniques_detected,
          created_at: inv.evidence_chain[0]?.timestamp || new Date().toISOString(),
        } : null;
      })
    );

    return NextResponse.json({
      investigations: summaries.filter(s => s !== null),
      total: investigations.length,
    });

  } catch (error) {
    return NextResponse.json({
      error: 'Failed to list investigations',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

// Route handlers for different HTTP methods
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'health':
      return handleHealthCheck();
    case 'export':
      return handleExport(request);
    case 'list':
      return handleList();
    default:
      return NextResponse.json({
        message: 'AI-Powered Misinformation Detection API',
        version: '1.0.0',
        endpoints: {
          'POST /': 'Start new investigation',
          'GET /?action=health': 'Health check',
          'GET /?action=list': 'List investigations',
          'GET /?action=export&id=<id>': 'Export investigation',
        },
        example_request: {
          type: 'full_investigation',
          content: {
            claim: 'This video shows recent events in [location]',
            media_url: 'https://example.com/video.mp4',
            context: 'Shared widely on social media with claim of being recent news'
          },
          options: {
            include_forensics: true,
            generate_lesson: true,
            create_timeline: true
          }
        }
      });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleInvestigation(request);
}

// Cleanup on process exit
if (typeof process !== 'undefined') {
  const cleanup = async () => {
    if (orchestrator) {
      console.log('Cleaning up orchestrator...');
      await orchestrator.cleanup();
    }
    if (clientManager) {
      console.log('Cleaning up MCP client manager...');
      await clientManager.closeAll();
    }
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
  process.on('beforeExit', cleanup);
}