// app/api/agent/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { InvestigationOrchestrator, InvestigationRequest } from '@/lib/orchestrator';
import { McpClientManager } from '@/client/McpClientManager';
import path from 'path';

// Global orchestrator instance (in production, use proper dependency injection)
let orchestrator: InvestigationOrchestrator | null = null;
let clientManager: McpClientManager | null = null;
let initializationPromise: Promise<InvestigationOrchestrator> | null = null;

async function initializeOrchestrator(): Promise<InvestigationOrchestrator> {
  // Return existing orchestrator if already initialized
  if (orchestrator) {
    return orchestrator;
  }

  // Return existing initialization promise if in progress
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start new initialization
  initializationPromise = (async () => {
    console.log('Initializing MCP orchestrator...');

    try {
      // Create and configure MCP client manager
      clientManager = new McpClientManager(30000);
      
      // Get the project root path
      const projectRoot = process.cwd();
      
      // Add MCP server configurations with absolute paths
      clientManager.addServer({
        name: 'factcheck',
        command: 'node',
        args: [path.join(projectRoot, 'dist/servers/factcheck/server.js')],
        env: {
          GOOGLE_FACTCHECK_API_KEY: process.env.GOOGLE_FACTCHECK_API_KEY || '',
          SIGNING_SECRET: process.env.SIGNING_SECRET || 'dev-secret-key',
        },
        timeout: 30000,
      });

      clientManager.addServer({
        name: 'video-forensics',
        command: 'node',
        args: [path.join(projectRoot, 'dist/servers/video-forensics/server.js')],
        env: {
          TEMP_DIR: process.env.TEMP_DIR || '/tmp/video-forensics',
          GOOGLE_VISION_API_KEY: process.env.GOOGLE_VISION_API_KEY || '',
        },
        timeout: 60000, // Longer timeout for video processing
      });

      clientManager.addServer({
        name: 'web-fetch',
        command: 'node',
        args: [path.join(projectRoot, 'dist/servers/web-fetch/server.js')],
        env: {
          USER_AGENT: 'FactCheck-Bot/1.0 (+https://factcheck-platform.example.com)',
        },
        timeout: 30000,
      });

      // Connect to all servers
      await clientManager.connectAll();
      
      const connectedServers = clientManager.listConnectedServers();
      console.log('Connected MCP servers:', connectedServers);

      // Create orchestrator with MCP client manager
      orchestrator = new InvestigationOrchestrator(clientManager);

      console.log('MCP orchestrator initialized successfully');
      return orchestrator;

    } catch (error) {
      console.error('Failed to initialize orchestrator:', error);
      
      // Reset state on failure
      orchestrator = null;
      initializationPromise = null;
      
      throw new Error(`Orchestrator initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  })();

  return initializationPromise;
}

// Health check endpoint
async function handleHealthCheck(): Promise<NextResponse> {
  try {
    if (!clientManager) {
      return NextResponse.json({
        status: 'initializing',
        message: 'MCP client manager not initialized',
        available_servers: [],
        connected_count: 0,
      }, { status: 503 });
    }

    const healthStatus = await clientManager.healthCheck();
    const connectedServers = clientManager.listConnectedServers();
    const allTools = await clientManager.getAllTools();
    
    return NextResponse.json({
      status: connectedServers.length > 0 ? 'healthy' : 'degraded',
      servers: healthStatus,
      connected_servers: connectedServers,
      connected_count: connectedServers.length,
      total_servers: clientManager.listAllServers().length,
      available_tools: allTools,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Health check failed:', error);
    return NextResponse.json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}

// Main investigation endpoint
async function handleInvestigation(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    
    // Validate request structure
    if (!body.type || !body.content) {
      return NextResponse.json({
        error: 'Invalid request format',
        message: 'Request must include "type" and "content" fields',
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
        },
        valid_types: ['fact_check', 'media_analysis', 'full_investigation']
      }, { status: 400 });
    }

    // Validate investigation type
    const validTypes = ['fact_check', 'media_analysis', 'full_investigation'];
    if (!validTypes.includes(body.type)) {
      return NextResponse.json({
        error: 'Invalid investigation type',
        message: `Type must be one of: ${validTypes.join(', ')}`,
        received: body.type
      }, { status: 400 });
    }

    // Validate content based on type
    if (body.type === 'fact_check' && !body.content.claim) {
      return NextResponse.json({
        error: 'Missing required field',
        message: 'fact_check investigations require a "claim" in content',
      }, { status: 400 });
    }

    if (body.type === 'media_analysis' && !body.content.media_url) {
      return NextResponse.json({
        error: 'Missing required field', 
        message: 'media_analysis investigations require a "media_url" in content',
      }, { status: 400 });
    }

    // Initialize orchestrator if needed
    console.log('Initializing orchestrator for investigation...');
    const orch = await initializeOrchestrator();

    // Prepare investigation request
    const investigationRequest: InvestigationRequest = {
      type: body.type,
      content: {
        claim: body.content.claim || undefined,
        media_url: body.content.media_url || undefined,
        context: body.content.context || undefined,
      },
      options: {
        include_forensics: body.options?.include_forensics ?? true,
        generate_lesson: body.options?.generate_lesson ?? true,
        create_timeline: body.options?.create_timeline ?? true,
      },
    };

    console.log('Starting investigation:', {
      type: investigationRequest.type,
      has_claim: !!investigationRequest.content.claim,
      has_media: !!investigationRequest.content.media_url,
      has_context: !!investigationRequest.content.context,
    });

    // Perform investigation with timeout
    const startTime = Date.now();
    const INVESTIGATION_TIMEOUT = 120000; // 2 minutes
    
    const investigationPromise = orch.investigate(investigationRequest);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Investigation timeout - analysis took too long'));
      }, INVESTIGATION_TIMEOUT);
    });

    const result = await Promise.race([investigationPromise, timeoutPromise]);
    const processingTime = Date.now() - startTime;

    console.log(`Investigation completed in ${processingTime}ms:`, {
      id: result.id,
      verdict: result.verdict,
      confidence: result.confidence,
      evidence_count: result.evidence_chain.length,
      techniques_count: result.techniques_detected.length,
    });

    // Return result with additional metadata
    return NextResponse.json({
      ...result,
      processing_time_ms: processingTime,
      api_version: '1.0.0',
      timestamp: new Date().toISOString(),
      request_metadata: {
        type: investigationRequest.type,
        options: investigationRequest.options,
      }
    });

  } catch (error) {
    console.error('Investigation failed:', error);
    
    // Determine appropriate error response based on error type
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        return NextResponse.json({
          error: 'Investigation timeout',
          message: 'The analysis took too long to complete. Please try again with simpler content.',
          timestamp: new Date().toISOString(),
        }, { status: 408 });
      }
      
      if (error.message.includes('not connected') || error.message.includes('not found')) {
        return NextResponse.json({
          error: 'Service unavailable',
          message: 'Required analysis services are currently unavailable. Please try again later.',
          timestamp: new Date().toISOString(),
        }, { status: 503 });
      }
    }
    
    return NextResponse.json({
      error: 'Investigation failed',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
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
        error: 'Missing parameter',
        message: 'Investigation ID is required as a query parameter'
      }, { status: 400 });
    }

    if (!orchestrator) {
      return NextResponse.json({
        error: 'Service unavailable',
        message: 'Orchestrator not initialized'
      }, { status: 503 });
    }

    const exportData = await orchestrator.exportInvestigation(investigationId);

    // Set appropriate headers for download
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="investigation-${investigationId}.json"`,
      'Cache-Control': 'no-cache',
    });

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers,
    });

  } catch (error) {
    console.error('Export failed:', error);
    
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({
        error: 'Investigation not found',
        message: 'The requested investigation ID does not exist',
      }, { status: 404 });
    }

    return NextResponse.json({
      error: 'Export failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

// List investigations endpoint
async function handleList(): Promise<NextResponse> {
  try {
    if (!orchestrator) {
      return NextResponse.json({
        error: 'Service unavailable',
        message: 'Orchestrator not initialized'
      }, { status: 503 });
    }

    const investigations = await orchestrator.listInvestigations();

    // Get summary info for each investigation
    const summaries = await Promise.all(
      investigations.map(async (id) => {
        try {
          const inv = await orchestrator!.getInvestigation(id);
          return inv ? {
            id,
            verdict: inv.verdict,
            confidence: inv.confidence,
            evidence_count: inv.evidence_chain.length,
            techniques_detected: inv.techniques_detected,
            created_at: inv.evidence_chain[0]?.timestamp || new Date().toISOString(),
            processing_time_ms: inv.processing_time_ms,
          } : null;
        } catch (error) {
          console.warn(`Failed to get summary for investigation ${id}:`, error);
          return null;
        }
      })
    );

    const validSummaries = summaries.filter(s => s !== null);

    return NextResponse.json({
      investigations: validSummaries,
      total: validSummaries.length,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('List investigations failed:', error);
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

  try {
    switch (action) {
      case 'health':
        return await handleHealthCheck();
      case 'export':
        return await handleExport(request);
      case 'list':
        return await handleList();
      default:
        // API documentation endpoint
        return NextResponse.json({
          message: 'AI-Powered Misinformation Detection API',
          version: '1.0.0',
          status: 'operational',
          endpoints: {
            'POST /api/agent': 'Start new investigation',
            'GET /api/agent?action=health': 'Health check and server status',
            'GET /api/agent?action=list': 'List all investigations',
            'GET /api/agent?action=export&id=<id>': 'Export investigation results',
          },
          investigation_types: [
            {
              type: 'fact_check',
              description: 'Verify claims against reliable sources',
              required_fields: ['claim'],
              optional_fields: ['context']
            },
            {
              type: 'media_analysis', 
              description: 'Analyze images and videos for manipulation',
              required_fields: ['media_url'],
              optional_fields: ['context']
            },
            {
              type: 'full_investigation',
              description: 'Comprehensive analysis combining fact-checking and media forensics',
              required_fields: ['claim OR media_url'],
              optional_fields: ['claim', 'media_url', 'context']
            }
          ],
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
          },
          timestamp: new Date().toISOString(),
        });
    }
  } catch (error) {
    console.error(`GET request failed for action ${action}:`, error);
    return NextResponse.json({
      error: 'Request failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      action: action,
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return await handleInvestigation(request);
}

// OPTIONS handler for CORS preflight requests
export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// Cleanup function for graceful shutdown
async function cleanup() {
  console.log('API route cleanup initiated...');
  
  try {
    if (orchestrator) {
      await orchestrator.cleanup();
      orchestrator = null;
    }
    
    if (clientManager) {
      await clientManager.closeAll();
      clientManager = null;
    }
    
    initializationPromise = null;
    console.log('API route cleanup completed');
  } catch (error) {
    console.error('Cleanup failed:', error);
  }
}

// Register cleanup handlers (Node.js only)
if (typeof process !== 'undefined') {
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
  process.on('beforeExit', cleanup);
  
  // Handle uncaught exceptions gracefully
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    cleanup().finally(() => process.exit(1));
  });
  
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
  });
}