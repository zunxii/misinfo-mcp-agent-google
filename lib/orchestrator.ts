import { McpClientManager } from '../client/McpClientManager';
import { CryptoUtils } from '../utils/crypto.utils';

export interface InvestigationRequest {
  type: 'fact_check' | 'media_analysis' | 'full_investigation';
  content: {
    claim?: string;
    media_url?: string;
    context?: string;
  };
  options: {
    include_forensics: boolean;
    generate_lesson: boolean;
    create_timeline: boolean;
  };
}

export interface EvidenceItem {
  id: string;
  type: 'fact_check' | 'forensic' | 'web_search' | 'reverse_image' | 'archive';
  source: string;
  content: string;
  confidence: number;
  timestamp: string;
  metadata: any;
}

export interface TimelineEvent {
  timestamp: string;
  event_type: 'first_appearance' | 'modification' | 'spread' | 'fact_check';
  description: string;
  source: string;
  confidence: number;
  media_snapshot?: string;
}

export interface InvestigationResult {
  id: string;
  verdict: 'TRUE' | 'FALSE' | 'MIXED' | 'UNVERIFIED';
  confidence: number;
  explanation: string;
  evidence_chain: EvidenceItem[];
  forensic_analysis?: any;
  timeline?: TimelineEvent[];
  techniques_detected: string[];
  counterfactuals?: any[];
  signed_artifact: {
    id: string;
    sha256: string;
    signature: string;
    exportable_json_ld?: any;
  };
  micro_lesson?: any;
  processing_time_ms?: number;
}

export class InvestigationOrchestrator {
  private investigations: Map<string, InvestigationResult> = new Map();
  private clientManager: McpClientManager;

  constructor(clientManager: McpClientManager) {
    this.clientManager = clientManager;
  }

  async investigate(request: InvestigationRequest): Promise<InvestigationResult> {
    const investigationId = CryptoUtils.generateId();
    const startTime = Date.now();

    console.log(`Starting investigation ${investigationId}:`, {
      type: request.type,
      has_claim: !!request.content.claim,
      has_media: !!request.content.media_url,
    });

    try {
      // Initialize evidence chain
      const evidenceChain: EvidenceItem[] = [];
      let forensicAnalysis: any = null;
      let timeline: TimelineEvent[] = [];

      // Step 1: Fact-checking (if claim provided)
      if (request.content.claim) {
        const factCheckEvidence = await this.performFactCheck(request.content.claim, request.content.context);
        evidenceChain.push(...factCheckEvidence);
      }

      // Step 2: Media analysis (if media provided and requested)
      if (request.content.media_url && (request.type === 'media_analysis' || request.type === 'full_investigation')) {
        if (request.options.include_forensics) {
          forensicAnalysis = await this.performMediaForensics(request.content.media_url);
          
          // Add forensic evidence to chain
          if (forensicAnalysis) {
            evidenceChain.push({
              id: CryptoUtils.generateId(),
              type: 'forensic',
              source: 'video_forensics_analysis',
              content: `Media forensic analysis completed. Tampering probability: ${Math.round((forensicAnalysis.tampering_probability || 0) * 100)}%`,
              confidence: 1 - (forensicAnalysis.tampering_probability || 0),
              timestamp: new Date().toISOString(),
              metadata: {
                techniques_detected: forensicAnalysis.techniques_detected || [],
                suspicious_frames: forensicAnalysis.suspicious_frames?.length || 0,
              },
            });
          }
        }

        // Web search for similar media
        const reverseSearchEvidence = await this.performReverseImageSearch(request.content.media_url);
        evidenceChain.push(...reverseSearchEvidence);
      }

      // Step 3: Web evidence gathering
      if (request.content.claim) {
        const webEvidence = await this.gatherWebEvidence(request.content.claim);
        evidenceChain.push(...webEvidence);
      }

      // Step 4: Generate timeline if requested
      if (request.options.create_timeline) {
        timeline = await this.generateTimeline(evidenceChain, forensicAnalysis);
      }

      // Step 5: Synthesize verdict
      const { verdict, confidence, explanation } = this.synthesizeVerdict(
        evidenceChain,
        forensicAnalysis,
        request.content.claim
      );

      // Step 6: Detect techniques
      const techniquesDetected = this.detectTechniques(evidenceChain, forensicAnalysis);

      // Step 7: Generate micro-lesson if requested
      let microLesson: any = null;
      if (request.options.generate_lesson) {
        microLesson = this.generateMicroLesson(techniquesDetected, verdict);
      }

      // Create signed artifact
      const artifactData = {
        id: investigationId,
        verdict,
        confidence,
        evidence_chain: evidenceChain,
        timestamp: new Date().toISOString(),
        request: request,
      };

      const artifactJson = JSON.stringify(artifactData);
      const sha256 = CryptoUtils.computeSha256(artifactJson);
      const signature = CryptoUtils.signArtifact(artifactJson);

      const result: InvestigationResult = {
        id: investigationId,
        verdict,
        confidence,
        explanation,
        evidence_chain: evidenceChain,
        forensic_analysis: forensicAnalysis,
        timeline: timeline.length > 0 ? timeline : undefined,
        techniques_detected: techniquesDetected,
        signed_artifact: {
          id: investigationId,
          sha256,
          signature,
          exportable_json_ld: this.generateJsonLD(artifactData),
        },
        micro_lesson: microLesson,
        processing_time_ms: Date.now() - startTime,
      };

      // Store result
      this.investigations.set(investigationId, result);

      console.log(`Investigation ${investigationId} completed:`, {
        verdict,
        confidence,
        evidence_count: evidenceChain.length,
        processing_time: result.processing_time_ms,
      });

      return result;

    } catch (error) {
      console.error(`Investigation ${investigationId} failed:`, error);
      throw new Error(`Investigation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async performFactCheck(claim: string, context?: string): Promise<EvidenceItem[]> {
    const evidence: EvidenceItem[] = [];

    try {
      // Call fact-check MCP server
      const factCheckClient = this.clientManager.getClient('factcheck');
      if (factCheckClient?.connected) {
        const result = await this.clientManager.callTool('factcheck', 'check_claim', {
          claim,
          context,
        });

        if (result && result.evidence) {
          result.evidence.forEach((item: any) => {
            evidence.push({
              id: item.id,
              type: 'fact_check',
              source: item.source,
              content: item.content,
              confidence: item.confidence,
              timestamp: item.timestamp,
              metadata: item,
            });
          });
        }

        // Also search existing fact-checks
        const searchResults = await this.clientManager.callTool('factcheck', 'search_factchecks', {
          query: claim,
        });

        if (searchResults && Array.isArray(searchResults)) {
          searchResults.forEach((item: any, index: number) => {
            if (item.claimReview && item.claimReview[0]) {
              const review = item.claimReview[0];
              evidence.push({
                id: CryptoUtils.generateId(),
                type: 'fact_check',
                source: review.publisher?.name || 'External Fact Checker',
                content: `Previous fact-check: ${review.textualRating} - ${review.url}`,
                confidence: 0.9,
                timestamp: review.reviewDate || new Date().toISOString(),
                metadata: item,
              });
            }
          });
        }
      }
    } catch (error) {
      console.error('Fact-check failed:', error);
      // Add fallback evidence
      evidence.push({
        id: CryptoUtils.generateId(),
        type: 'fact_check',
        source: 'system',
        content: `Unable to complete fact-check: ${error instanceof Error ? error.message : 'Service unavailable'}`,
        confidence: 0.1,
        timestamp: new Date().toISOString(),
        metadata: { error: true },
      });
    }

    return evidence;
  }

  private async performMediaForensics(mediaUrl: string): Promise<any> {
    try {
      const forensicsClient = this.clientManager.getClient('video-forensics');
      if (!forensicsClient?.connected) {
        throw new Error('Video forensics service unavailable');
      }

      // Determine analysis type based on URL
      const isVideo = /\.(mp4|avi|mov|mkv|webm)$/i.test(mediaUrl);
      
      if (isVideo) {
        const result = await this.clientManager.callTool('video-forensics', 'analyze_video', {
          video_url: mediaUrl,
          analysis_type: 'full',
        });
        return result;
      } else {
        const result = await this.clientManager.callTool('video-forensics', 'analyze_image', {
          image_url: mediaUrl,
          analysis_methods: ['ela', 'noise', 'metadata'],
        });
        return result;
      }
    } catch (error) {
      console.error('Media forensics failed:', error);
      return {
        tampering_probability: 0.5,
        techniques_detected: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async performReverseImageSearch(mediaUrl: string): Promise<EvidenceItem[]> {
    const evidence: EvidenceItem[] = [];

    try {
      const webClient = this.clientManager.getClient('web-fetch');
      if (webClient?.connected) {
        // Search for similar images/content
        const searchResults = await this.clientManager.callTool('web-fetch', 'search', {
          query: `reverse image search: ${mediaUrl}`,
          max_results: 5,
        });

        if (searchResults?.results) {
          searchResults.results.forEach((result: any) => {
            evidence.push({
              id: CryptoUtils.generateId(),
              type: 'reverse_image',
              source: result.source || 'web_search',
              content: `Similar content found: ${result.title} - ${result.snippet}`,
              confidence: result.relevanceScore || 0.7,
              timestamp: new Date().toISOString(),
              metadata: result,
            });
          });
        }
      }
    } catch (error) {
      console.error('Reverse image search failed:', error);
    }

    return evidence;
  }

  private async gatherWebEvidence(claim: string): Promise<EvidenceItem[]> {
    const evidence: EvidenceItem[] = [];

    try {
      const webClient = this.clientManager.getClient('web-fetch');
      if (webClient?.connected) {
        const searchResults = await this.clientManager.callTool('web-fetch', 'search', {
          query: claim,
          max_results: 10,
        });

        if (searchResults?.results) {
          for (const result of searchResults.results.slice(0, 3)) {
            try {
              // Fetch the actual content
              const pageContent = await this.clientManager.callTool('web-fetch', 'fetch_url', {
                url: result.url,
                timeout: 10000,
              });

              evidence.push({
                id: CryptoUtils.generateId(),
                type: 'web_search',
                source: result.url,
                content: `Web source: ${result.title} - ${result.snippet}`,
                confidence: 0.6,
                timestamp: new Date().toISOString(),
                metadata: { ...result, content: pageContent?.content },
              });
            } catch (error) {
              console.warn(`Failed to fetch ${result.url}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error('Web evidence gathering failed:', error);
    }

    return evidence;
  }

  private async generateTimeline(evidence: EvidenceItem[], forensics: any): Promise<TimelineEvent[]> {
    const timeline: TimelineEvent[] = [];

    // Add evidence points to timeline
    evidence.forEach(item => {
      let eventType: TimelineEvent['event_type'] = 'fact_check';
      
      if (item.type === 'forensic') eventType = 'modification';
      else if (item.type === 'reverse_image') eventType = 'first_appearance';
      else if (item.type === 'web_search') eventType = 'spread';

      timeline.push({
        timestamp: item.timestamp,
        event_type: eventType,
        description: item.content,
        source: item.source,
        confidence: item.confidence,
      });
    });

    // Add forensic timeline events
    if (forensics?.timeline) {
      forensics.timeline.forEach((event: any) => {
        timeline.push({
          timestamp: new Date(Date.now() - event.timestamp * 1000).toISOString(),
          event_type: 'modification',
          description: event.event,
          source: 'forensic_analysis',
          confidence: event.confidence,
        });
      });
    }

    // Sort by timestamp
    return timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  private synthesizeVerdict(
    evidence: EvidenceItem[],
    forensics: any,
    claim?: string
  ): { verdict: InvestigationResult['verdict']; confidence: number; explanation: string } {
    let trueScore = 0;
    let falseScore = 0;
    let totalWeight = 0;

    // Analyze evidence
    evidence.forEach(item => {
      const weight = item.confidence;
      totalWeight += weight;

      if (item.type === 'fact_check') {
        // Parse fact-check results
        if (item.content.toLowerCase().includes('false') || item.content.toLowerCase().includes('incorrect')) {
          falseScore += weight;
        } else if (item.content.toLowerCase().includes('true') || item.content.toLowerCase().includes('correct')) {
          trueScore += weight;
        }
      } else if (item.type === 'forensic') {
        // High tampering probability suggests false
        const tamperingProb = forensics?.tampering_probability || 0;
        if (tamperingProb > 0.7) {
          falseScore += weight * tamperingProb;
        }
      }
    });

    // Determine verdict
    let verdict: InvestigationResult['verdict'] = 'UNVERIFIED';
    let confidence = 0.5;

    if (totalWeight > 0) {
      const trueRatio = trueScore / totalWeight;
      const falseRatio = falseScore / totalWeight;
      
      if (falseRatio > 0.6) {
        verdict = 'FALSE';
        confidence = Math.min(falseRatio, 0.95);
      } else if (trueRatio > 0.6) {
        verdict = 'TRUE';
        confidence = Math.min(trueRatio, 0.95);
      } else if (trueRatio > 0.3 && falseRatio > 0.3) {
        verdict = 'MIXED';
        confidence = Math.min((trueRatio + falseRatio) / 2, 0.8);
      }
    }

    const explanation = this.generateExplanation(verdict, confidence, evidence.length, forensics);

    return { verdict, confidence, explanation };
  }

  private generateExplanation(verdict: string, confidence: number, evidenceCount: number, forensics: any): string {
    const confidencePercent = Math.round(confidence * 100);
    let explanation = `Based on analysis of ${evidenceCount} evidence sources, this claim is assessed as ${verdict} with ${confidencePercent}% confidence. `;

    if (forensics) {
      const tamperingProb = Math.round((forensics.tampering_probability || 0) * 100);
      explanation += `Media forensic analysis indicates ${tamperingProb}% probability of tampering. `;
    }

    if (verdict === 'FALSE') {
      explanation += 'Multiple reliable sources contradict this claim.';
    } else if (verdict === 'TRUE') {
      explanation += 'Evidence from credible sources supports this claim.';
    } else if (verdict === 'MIXED') {
      explanation += 'Evidence shows both supporting and contradicting information.';
    } else {
      explanation += 'Insufficient evidence available for definitive assessment.';
    }

    return explanation;
  }

  private detectTechniques(evidence: EvidenceItem[], forensics: any): string[] {
    const techniques: string[] = [];

    // From forensic analysis
    if (forensics?.techniques_detected) {
      techniques.push(...forensics.techniques_detected);
    }

    // From evidence patterns
    const hasMultipleSources = evidence.filter(e => e.type === 'fact_check').length > 1;
    const hasForensicEvidence = evidence.some(e => e.type === 'forensic');
    const hasReverseSearch = evidence.some(e => e.type === 'reverse_image');

    if (hasMultipleSources) techniques.push('cross_reference_analysis');
    if (hasForensicEvidence) techniques.push('digital_forensics');
    if (hasReverseSearch) techniques.push('reverse_image_search');

    return [...new Set(techniques)];
  }

  private generateMicroLesson(techniques: string[], verdict: string): any {
    const primaryTechnique = techniques[0] || 'fact_checking';
    
    const lessons: Record<string, any> = {
      fact_checking: {
        technique: 'Fact-Checking Basics',
        explanation: 'Fact-checking involves verifying claims against reliable, authoritative sources. Always check multiple sources and look for primary evidence.',
        duration_seconds: 60,
        interactive_elements: [
          {
            type: 'question',
            content: 'What should you do when you see a claim on social media?',
            correct_answer: 'Check multiple reliable sources before sharing or believing it.',
          }
        ],
      },
      digital_forensics: {
        technique: 'Digital Media Analysis',
        explanation: 'Digital forensics can detect signs of manipulation in images and videos by analyzing compression artifacts, noise patterns, and metadata.',
        duration_seconds: 90,
        interactive_elements: [
          {
            type: 'visual_comparison',
            content: 'Manipulated images often show inconsistent lighting, shadows, or image quality in different areas.',
          }
        ],
      },
      reverse_image_search: {
        technique: 'Reverse Image Search',
        explanation: 'Use reverse image search to find the original source of images and check if they have been used in different contexts.',
        duration_seconds: 45,
        interactive_elements: [
          {
            type: 'question',
            content: 'How can you verify if an image is being used out of context?',
            correct_answer: 'Use reverse image search to find the original source and publication date.',
          }
        ],
      },
    };

    return lessons[primaryTechnique] || lessons['fact_checking'];
  }

  private generateJsonLD(data: any): any {
    return {
      '@context': 'https://schema.org',
      '@type': 'FactCheck',
      datePublished: new Date().toISOString(),
      url: `https://factcheck-platform.example.com/investigation/${data.id}`,
      claimReviewed: data.request.content.claim,
      reviewRating: {
        '@type': 'Rating',
        ratingValue: data.verdict,
        ratingExplanation: data.explanation,
        confidence: data.confidence,
      },
      author: {
        '@type': 'Organization',
        name: 'AI Misinformation Detection System',
      },
    };
  }

  async exportInvestigation(id: string): Promise<any> {
    const investigation = this.investigations.get(id);
    if (!investigation) {
      throw new Error(`Investigation ${id} not found`);
    }

    return {
      ...investigation,
      export_timestamp: new Date().toISOString(),
      format_version: '1.0',
    };
  }

  async listInvestigations(): Promise<string[]> {
    return Array.from(this.investigations.keys());
  }

  async getInvestigation(id: string): Promise<InvestigationResult | null> {
    return this.investigations.get(id) || null;
  }

  async cleanup(): Promise<void> {
    // Cleanup resources if needed
    console.log('Orchestrator cleanup completed');
  }
}