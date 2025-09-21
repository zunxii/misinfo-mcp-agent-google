import { McpClient } from './mcp-client.js';

export interface InvestigationRequest {
  type: 'fact_check' | 'media_analysis' | 'full_investigation';
  content: {
    claim?: string;
    media_url?: string;
    context?: string;
    source_url?: string;
  };
  options?: {
    include_forensics?: boolean;
    generate_lesson?: boolean;
    create_timeline?: boolean;
  };
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
  counterfactuals?: CounterfactualNarrative[];
  signed_artifact: {
    id: string;
    sha256: string;
    signature: string;
    exportable_json_ld?: any;
  };
  micro_lesson?: MicroLesson;
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

export interface CounterfactualNarrative {
  narrative: string;
  plausibility_score: number;
  evidence_gaps: string[];
  citations: string[];
}

export interface MicroLesson {
  technique: string;
  explanation: string;
  interactive_elements: Array<{
    type: 'question' | 'visual_comparison' | 'audio_sample';
    content: string;
    correct_answer?: string;
  }>;
  duration_seconds: number;
}

export class InvestigationOrchestrator {
  private clients: Map<string, McpClient> = new Map();
  private investigationHistory: Map<string, InvestigationResult> = new Map();

  constructor(serverConfigs: Array<{ name: string; command: string; args: string[]; env?: Record<string, string> }>) {
    this.initializeClients(serverConfigs);
  }

  private async initializeClients(configs: Array<{ name: string; command: string; args: string[]; env?: Record<string, string> }>): Promise<void> {
    for (const config of configs) {
      try {
        const client = new McpClient(config.name);
        await client.connect(config.command, config.args, config.env);
        this.clients.set(config.name, client);
        console.log(`Connected to ${config.name} MCP server`);
      } catch (error) {
        console.error(`Failed to connect to ${config.name}:`, error);
      }
    }
  }

  async investigate(request: InvestigationRequest): Promise<InvestigationResult> {
    const investigationId = this.generateInvestigationId();
    console.log(`Starting investigation ${investigationId} for type: ${request.type}`);

    try {
      switch (request.type) {
        case 'fact_check':
          return await this.performFactCheck(investigationId, request);
        case 'media_analysis':
          return await this.performMediaAnalysis(investigationId, request);
        case 'full_investigation':
          return await this.performFullInvestigation(investigationId, request);
        default:
          throw new Error(`Unknown investigation type: ${request.type}`);
      }
    } catch (error) {
      console.error(`Investigation ${investigationId} failed:`, error);
      throw error;
    }
  }

  private async performFactCheck(id: string, request: InvestigationRequest): Promise<InvestigationResult> {
    const { claim, context } = request.content;
    
    if (!claim) {
      throw new Error('Claim is required for fact-checking');
    }

    // Step 1: Scout Agent - Initial fact check
    const factCheckClient = this.clients.get('factcheck');
    if (!factCheckClient) {
      throw new Error('FactCheck MCP server not available');
    }

    console.log(`[${id}] Running initial fact check...`);
    const factCheckResult = await factCheckClient.callTool('check_claim', {
      claim,
      context,
    });

    const evidence: EvidenceItem[] = [];
    
    // Add fact-check evidence
    if (factCheckResult.evidence) {
      factCheckResult.evidence.forEach((item: any) => {
        evidence.push({
          id: item.id || this.generateId(),
          type: 'fact_check',
          source: item.source,
          content: item.content,
          confidence: item.confidence,
          timestamp: item.timestamp,
          metadata: item,
        });
      });
    }

    // Step 2: Search Agent - Find additional evidence
    const webSearchClient = this.clients.get('web-search');
    if (webSearchClient) {
      console.log(`[${id}] Searching for additional evidence...`);
      try {
        const searchResult = await webSearchClient.callTool('search', {
          query: claim,
          include_archives: true,
        });
        
        if (searchResult.results) {
          searchResult.results.slice(0, 5).forEach((result: any) => {
            evidence.push({
              id: this.generateId(),
              type: 'web_search',
              source: result.url || result.source,
              content: result.snippet || result.content,
              confidence: result.relevance_score || 0.7,
              timestamp: new Date().toISOString(),
              metadata: result,
            });
          });
        }
      } catch (error) {
        console.warn(`[${id}] Web search failed:`, error);
      }
    }

    // Step 3: Generate timeline
    const timeline = await this.generateTimeline(evidence);

    // Step 4: Generate counterfactuals
    const counterfactuals = await this.generateCounterfactuals(claim, evidence);

    // Step 5: Create micro-lesson
    const microLesson = request.options?.generate_lesson ? 
      await this.createMicroLesson(factCheckResult.techniques_detected?.[0] || 'misinformation_detection') : 
      undefined;

    // Step 6: Create exportable artifact
    const exportableJsonLd = await this.generateClaimReviewJsonLd(claim, factCheckResult, evidence);

    const result: InvestigationResult = {
      id,
      verdict: factCheckResult.verdict || 'UNVERIFIED',
      confidence: factCheckResult.confidence || 0.5,
      explanation: factCheckResult.explanation || 'Analysis completed',
      evidence_chain: evidence,
      timeline,
      techniques_detected: factCheckResult.techniques_detected || [],
      counterfactuals,
      signed_artifact: {
        ...factCheckResult.signedArtifact,
        exportable_json_ld: exportableJsonLd,
      },
      micro_lesson: microLesson,
    };

    this.investigationHistory.set(id, result);
    return result;
  }

  private async performMediaAnalysis(id: string, request: InvestigationRequest): Promise<InvestigationResult> {
    const { media_url, claim, context } = request.content;
    
    if (!media_url) {
      throw new Error('Media URL is required for media analysis');
    }

    const evidence: EvidenceItem[] = [];
    let forensicAnalysis: any = null;

    // Step 1: Forensic Agent - Analyze media
    const forensicsClient = this.clients.get('video-forensics');
    if (forensicsClient) {
      console.log(`[${id}] Running forensic analysis...`);
      
      try {
        if (this.isVideoUrl(media_url)) {
          const result = await forensicsClient.callTool('analyze_video', {
            video_url: media_url,
            analysis_type: 'full',
          });
          forensicAnalysis = result[0];
        } else if (this.isImageUrl(media_url)) {
          const result = await forensicsClient.callTool('analyze_image', {
            image_url: media_url,
            analysis_methods: ['ela', 'noise', 'metadata', 'reverse_search'],
          });
          forensicAnalysis = result[0];
        }

        if (forensicAnalysis) {
          evidence.push({
            id: this.generateId(),
            type: 'forensic',
            source: 'forensic_analysis',
            content: `Forensic analysis completed. Tampering probability: ${forensicAnalysis.tampering_probability || forensicAnalysis.manipulationProbability}`,
            confidence: 1 - (forensicAnalysis.tampering_probability || forensicAnalysis.manipulationProbability || 0),
            timestamp: new Date().toISOString(),
            metadata: forensicAnalysis,
          });
        }
      } catch (error) {
        console.warn(`[${id}] Forensic analysis failed:`, error);
      }
    }

    // Step 2: Reverse search for media
    const reverseSearchClient = this.clients.get('reverse-search');
    if (reverseSearchClient) {
      console.log(`[${id}] Running reverse image search...`);
      try {
        const searchResult = await reverseSearchClient.callTool('reverse_search', {
          media_url,
        });
        
        if (searchResult.matches) {
          searchResult.matches.slice(0, 5).forEach((match: any) => {
            evidence.push({
              id: this.generateId(),
              type: 'reverse_image',
              source: match.source_url,
              content: `Similar image found: ${match.description || 'No description'}`,
              confidence: match.similarity_score || 0.7,
              timestamp: match.first_seen || new Date().toISOString(),
              metadata: match,
            });
          });
        }
      } catch (error) {
        console.warn(`[${id}] Reverse search failed:`, error);
      }
    }

    // Step 3: If claim provided, also fact-check it
    let factCheckResult: any = null;
    if (claim) {
      const factCheckClient = this.clients.get('factcheck');
      if (factCheckClient) {
        console.log(`[${id}] Fact-checking associated claim...`);
        factCheckResult = await factCheckClient.callTool('check_claim', {
          claim,
          media_url,
          context,
        });

        if (factCheckResult.evidence) {
          factCheckResult.evidence.forEach((item: any) => {
            evidence.push({
              id: item.id || this.generateId(),
              type: 'fact_check',
              source: item.source,
              content: item.content,
              confidence: item.confidence,
              timestamp: item.timestamp,
              metadata: item,
            });
          });
        }
      }
    }

    // Determine overall verdict based on forensic and fact-check results
    const verdict = this.synthesizeVerdict(forensicAnalysis, factCheckResult);
    const confidence = this.calculateOverallConfidence(evidence, forensicAnalysis);

    const timeline = await this.generateTimeline(evidence);
    const techniques = this.extractTechniques(forensicAnalysis, factCheckResult);
    const counterfactuals = claim ? await this.generateCounterfactuals(claim, evidence) : [];

    const microLesson = request.options?.generate_lesson ? 
      await this.createMicroLesson(techniques[0] || 'media_manipulation_detection') : 
      undefined;

    // Create signed artifact
    const artifactData = JSON.stringify({
      media_url,
      claim,
      forensicAnalysis,
      factCheckResult,
      evidence,
      timestamp: new Date().toISOString(),
    });

    const signedArtifact = {
      id: this.generateId(),
      sha256: this.computeSha256(artifactData),
      signature: this.signArtifact(artifactData),
      exportable_json_ld: claim ? await this.generateClaimReviewJsonLd(claim, { verdict, confidence }, evidence) : null,
    };

    const result: InvestigationResult = {
      id,
      verdict,
      confidence,
      explanation: this.generateExplanation(verdict, evidence, forensicAnalysis),
      evidence_chain: evidence,
      forensic_analysis: forensicAnalysis,
      timeline,
      techniques_detected: techniques,
      counterfactuals,
      signed_artifact: signedArtifact,
      micro_lesson: microLesson,
    };

    this.investigationHistory.set(id, result);
    return result;
  }

  private async performFullInvestigation(id: string, request: InvestigationRequest): Promise<InvestigationResult> {
    console.log(`[${id}] Starting full investigation...`);
    
    // Full investigation combines both fact-checking and media analysis
    const { claim, media_url } = request.content;
    
    if (!claim && !media_url) {
      throw new Error('Either claim or media_url is required for full investigation');
    }

    // Start with media analysis if media is present
    let mediaResult: InvestigationResult | null = null;
    if (media_url) {
      mediaResult = await this.performMediaAnalysis(`${id}-media`, {
        type: 'media_analysis',
        content: { media_url, claim, context: request.content.context },
        options: { generate_lesson: false }, // We'll generate lesson at the end
      });
    }

    // Then perform fact check if claim is present
    let factCheckResult: InvestigationResult | null = null;
    if (claim) {
      factCheckResult = await this.performFactCheck(`${id}-fact`, {
        type: 'fact_check',
        content: { claim, media_url, context: request.content.context },
        options: { generate_lesson: false },
      });
    }

    // Merge results
    const combinedEvidence: EvidenceItem[] = [
      ...(mediaResult?.evidence_chain || []),
      ...(factCheckResult?.evidence_chain || []),
    ];

    // Remove duplicates based on content hash
    const uniqueEvidence = this.deduplicateEvidence(combinedEvidence);

    // Synthesize final verdict
    const verdict = this.synthesizeCombinedVerdict(mediaResult, factCheckResult);
    const confidence = this.calculateCombinedConfidence(mediaResult, factCheckResult, uniqueEvidence);

    const timeline = await this.generateTimeline(uniqueEvidence);
    const techniques = [
      ...(mediaResult?.techniques_detected || []),
      ...(factCheckResult?.techniques_detected || []),
    ].filter((t, i, arr) => arr.indexOf(t) === i); // Remove duplicates

    const counterfactuals = claim ? await this.generateCounterfactuals(claim, uniqueEvidence) : [];

    const microLesson = request.options?.generate_lesson ? 
      await this.createMicroLesson(techniques[0] || 'comprehensive_fact_checking') : 
      undefined;

    // Create comprehensive signed artifact
    const artifactData = JSON.stringify({
      claim,
      media_url,
      mediaAnalysis: mediaResult?.forensic_analysis,
      factCheckAnalysis: factCheckResult,
      evidence: uniqueEvidence,
      timestamp: new Date().toISOString(),
    });

    const signedArtifact = {
      id: this.generateId(),
      sha256: this.computeSha256(artifactData),
      signature: this.signArtifact(artifactData),
      exportable_json_ld: claim ? await this.generateClaimReviewJsonLd(claim, { verdict, confidence }, uniqueEvidence) : null,
    };

    const result: InvestigationResult = {
      id,
      verdict,
      confidence,
      explanation: this.generateCombinedExplanation(verdict, uniqueEvidence, mediaResult, factCheckResult),
      evidence_chain: uniqueEvidence,
      forensic_analysis: mediaResult?.forensic_analysis,
      timeline,
      techniques_detected: techniques,
      counterfactuals,
      signed_artifact: signedArtifact,
      micro_lesson: microLesson,
    };

    this.investigationHistory.set(id, result);
    return result;
  }

  // Helper methods
  private generateInvestigationId(): string {
    return `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  private isVideoUrl(url: string): boolean {
    return /\.(mp4|avi|mov|wmv|flv|webm)$/i.test(url) || url.includes('video') || url.includes('reel');
  }

  private isImageUrl(url: string): boolean {
    return /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(url) || url.includes('image');
  }

  private synthesizeVerdict(forensicResult: any, factCheckResult: any): 'TRUE' | 'FALSE' | 'MIXED' | 'UNVERIFIED' {
    if (factCheckResult?.verdict) {
      return factCheckResult.verdict;
    }

    if (forensicResult) {
      const tamperingProb = forensicResult.tampering_probability || forensicResult.manipulationProbability || 0;
      if (tamperingProb > 0.7) return 'FALSE';
      if (tamperingProb > 0.3) return 'MIXED';
      return 'UNVERIFIED';
    }

    return 'UNVERIFIED';
  }

  private synthesizeCombinedVerdict(
    mediaResult: InvestigationResult | null,
    factCheckResult: InvestigationResult | null
  ): 'TRUE' | 'FALSE' | 'MIXED' | 'UNVERIFIED' {
    const verdicts = [mediaResult?.verdict, factCheckResult?.verdict].filter(Boolean);
    
    if (verdicts.includes('FALSE')) return 'FALSE';
    if (verdicts.includes('MIXED')) return 'MIXED';
    if (verdicts.includes('TRUE') && verdicts.length === 1) return 'TRUE';
    if (verdicts.includes('TRUE') && verdicts.includes('UNVERIFIED')) return 'MIXED';
    
    return 'UNVERIFIED';
  }

  private calculateOverallConfidence(evidence: EvidenceItem[], forensicResult: any): number {
    if (evidence.length === 0) return 0.5;

    const avgEvidenceConfidence = evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length;
    
    if (forensicResult) {
      const forensicConfidence = 1 - (forensicResult.tampering_probability || forensicResult.manipulationProbability || 0.5);
      return (avgEvidenceConfidence + forensicConfidence) / 2;
    }

    return avgEvidenceConfidence;
  }

  private calculateCombinedConfidence(
    mediaResult: InvestigationResult | null,
    factCheckResult: InvestigationResult | null,
    evidence: EvidenceItem[]
  ): number {
    const confidences = [
      mediaResult?.confidence,
      factCheckResult?.confidence,
    ].filter((c): c is number => c !== undefined);

    if (confidences.length === 0) {
      return evidence.length > 0 ? 
        evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length : 
        0.5;
    }

    return confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
  }

  private extractTechniques(forensicResult: any, factCheckResult: any): string[] {
    const techniques = new Set<string>();

    if (forensicResult?.techniques_detected) {
      forensicResult.techniques_detected.forEach((t: string) => techniques.add(t));
    }

    if (factCheckResult?.techniques_detected) {
      factCheckResult.techniques_detected.forEach((t: string) => techniques.add(t));
    }

    return Array.from(techniques);
  }

  private deduplicateEvidence(evidence: EvidenceItem[]): EvidenceItem[] {
    const seen = new Set<string>();
    return evidence.filter(item => {
      const hash = this.computeSha256(item.content + item.source);
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    });
  }

  private generateExplanation(
    verdict: string,
    evidence: EvidenceItem[],
    forensicResult?: any
  ): string {
    let explanation = `Investigation resulted in verdict: ${verdict}. `;
    explanation += `Analysis based on ${evidence.length} evidence sources. `;

    if (forensicResult) {
      const tamperingProb = forensicResult.tampering_probability || forensicResult.manipulationProbability;
      if (tamperingProb !== undefined) {
        explanation += `Forensic analysis indicates ${Math.round(tamperingProb * 100)}% probability of tampering. `;
      }
    }

    const highConfidenceEvidence = evidence.filter(e => e.confidence > 0.8);
    if (highConfidenceEvidence.length > 0) {
      explanation += `${highConfidenceEvidence.length} high-confidence evidence sources support this assessment.`;
    }

    return explanation;
  }

  private generateCombinedExplanation(
    verdict: string,
    evidence: EvidenceItem[],
    mediaResult: InvestigationResult | null,
    factCheckResult: InvestigationResult | null
  ): string {
    let explanation = `Comprehensive investigation resulted in verdict: ${verdict}. `;
    
    if (mediaResult && factCheckResult) {
      explanation += `Combined analysis of media forensics and fact-checking. `;
    } else if (mediaResult) {
      explanation += `Based on media forensic analysis. `;
    } else if (factCheckResult) {
      explanation += `Based on fact-checking analysis. `;
    }

    explanation += `Total evidence sources: ${evidence.length}. `;

    if (mediaResult?.forensic_analysis) {
      const tamperingProb = mediaResult.forensic_analysis.tampering_probability || 
                           mediaResult.forensic_analysis.manipulationProbability;
      if (tamperingProb !== undefined) {
        explanation += `Media tampering probability: ${Math.round(tamperingProb * 100)}%. `;
      }
    }

    return explanation;
  }

  private async generateTimeline(evidence: EvidenceItem[]): Promise<TimelineEvent[]> {
    const timeline: TimelineEvent[] = [];

    // Sort evidence by timestamp
    const sortedEvidence = evidence.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    sortedEvidence.forEach((item, index) => {
      let eventType: TimelineEvent['event_type'] = 'spread';
      
      if (item.type === 'fact_check') eventType = 'fact_check';
      else if (item.type === 'reverse_image' && index === 0) eventType = 'first_appearance';
      else if (item.type === 'forensic') eventType = 'modification';

      timeline.push({
        timestamp: item.timestamp,
        event_type: eventType,
        description: this.summarizeEvidenceItem(item),
        source: item.source,
        confidence: item.confidence,
        media_snapshot: item.metadata?.thumbnail || item.metadata?.media_snapshot,
      });
    });

    return timeline;
  }

  private summarizeEvidenceItem(item: EvidenceItem): string {
    switch (item.type) {
      case 'fact_check':
        return `Fact-check result: ${item.content.substring(0, 100)}...`;
      case 'forensic':
        return `Forensic analysis: ${item.content.substring(0, 100)}...`;
      case 'web_search':
        return `Web evidence: ${item.content.substring(0, 100)}...`;
      case 'reverse_image':
        return `Similar content found: ${item.content.substring(0, 100)}...`;
      case 'archive':
        return `Archive entry: ${item.content.substring(0, 100)}...`;
      default:
        return item.content.substring(0, 100) + '...';
    }
  }

  private async generateCounterfactuals(claim: string, evidence: EvidenceItem[]): Promise<CounterfactualNarrative[]> {
    // Mock counterfactual generation - in production, this would use LLM
    const counterfactuals: CounterfactualNarrative[] = [];

    // Generate plausible alternative narratives
    const baseNarrative = `Alternative interpretation: ${claim} could be accurate if`;
    
    counterfactuals.push({
      narrative: `${baseNarrative} the evidence sources are incomplete or biased.`,
      plausibility_score: 0.3,
      evidence_gaps: ['Missing primary sources', 'Limited fact-checker coverage'],
      citations: evidence.slice(0, 2).map(e => e.source),
    });

    if (evidence.some(e => e.type === 'forensic')) {
      counterfactuals.push({
        narrative: `${baseNarrative} the forensic analysis has false positives due to compression artifacts.`,
        plausibility_score: 0.4,
        evidence_gaps: ['Technical analysis limitations', 'Compression effects'],
        citations: evidence.filter(e => e.type === 'forensic').map(e => e.source),
      });
    }

    counterfactuals.push({
      narrative: `${baseNarrative} the context or timing has been misunderstood.`,
      plausibility_score: 0.5,
      evidence_gaps: ['Historical context', 'Timeline verification'],
      citations: evidence.slice(-2).map(e => e.source),
    });

    return counterfactuals.sort((a, b) => b.plausibility_score - a.plausibility_score);
  }

  private async createMicroLesson(technique: string): Promise<MicroLesson> {
    // Mock micro-lesson creation - in production would be more sophisticated
    const lessons: Record<string, MicroLesson> = {
      'misinformation_detection': {
        technique: 'Misinformation Detection',
        explanation: 'Learn to identify common signs of misinformation by checking sources, dates, and context.',
        interactive_elements: [
          {
            type: 'question',
            content: 'What should you check first when evaluating a claim?',
            correct_answer: 'The original source and publication date',
          },
          {
            type: 'visual_comparison',
            content: 'Compare these two versions of the same story - what differences do you notice?',
          },
        ],
        duration_seconds: 45,
      },
      'media_manipulation_detection': {
        technique: 'Media Manipulation Detection',
        explanation: 'Understand how to spot digitally altered images and videos using forensic techniques.',
        interactive_elements: [
          {
            type: 'visual_comparison',
            content: 'Examine these compression artifacts - what do they tell us about editing?',
          },
          {
            type: 'question',
            content: 'Which technique is most reliable for detecting image manipulation?',
            correct_answer: 'Error Level Analysis (ELA) combined with metadata examination',
          },
        ],
        duration_seconds: 40,
      },
      'comprehensive_fact_checking': {
        technique: 'Comprehensive Fact Checking',
        explanation: 'Master the complete fact-checking process from initial assessment to final verification.',
        interactive_elements: [
          {
            type: 'question',
            content: 'What is the most important step in comprehensive fact-checking?',
            correct_answer: 'Cross-referencing multiple independent sources',
          },
          {
            type: 'visual_comparison',
            content: 'Review this evidence chain - how would you rate its reliability?',
          },
        ],
        duration_seconds: 50,
      },
    };

    return lessons[technique] || lessons['misinformation_detection'];
  }

  private async generateClaimReviewJsonLd(
    claim: string,
    result: { verdict: string; confidence: number },
    evidence: EvidenceItem[]
  ): Promise<any> {
    const now = new Date().toISOString();
    
    return {
      "@context": "https://schema.org",
      "@type": "ClaimReview",
      "url": `https://factcheck-platform.example.com/review/${this.generateId()}`,
      "claimReviewed": claim,
      "author": {
        "@type": "Organization",
        "name": "AI Fact-Check Platform",
        "url": "https://factcheck-platform.example.com"
      },
      "datePublished": now,
      "reviewRating": {
        "@type": "Rating",
        "ratingValue": this.verdictToRating(result.verdict),
        "bestRating": 5,
        "worstRating": 1,
        "alternateName": result.verdict
      },
      "itemReviewed": {
        "@type": "Claim",
        "text": claim,
        "datePublished": now
      },
      "evidence": evidence.slice(0, 5).map(e => ({
        "@type": "WebPage",
        "url": e.source,
        "description": e.content.substring(0, 200),
        "datePublished": e.timestamp
      }))
    };
  }

  private verdictToRating(verdict: string): number {
    switch (verdict) {
      case 'TRUE': return 5;
      case 'MIXED': return 3;
      case 'FALSE': return 1;
      case 'UNVERIFIED': return 2;
      default: return 2;
    }
  }

  private computeSha256(data: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private signArtifact(artifact: string): string {
    const crypto = require('crypto');
    const secret = process.env.SIGNING_SECRET || 'dev-secret';
    return crypto.createHmac('sha256', secret).update(artifact).digest('hex');
  }

  // Public methods for retrieving investigation history
  async getInvestigation(id: string): Promise<InvestigationResult | null> {
    return this.investigationHistory.get(id) || null;
  }

  async listInvestigations(): Promise<string[]> {
    return Array.from(this.investigationHistory.keys());
  }

  async exportInvestigation(id: string): Promise<any> {
    const investigation = this.investigationHistory.get(id);
    if (!investigation) {
      throw new Error(`Investigation ${id} not found`);
    }

    return {
      investigation,
      exportFormat: 'ClaimReview+Evidence',
      exportedAt: new Date().toISOString(),
      verification: {
        signature: investigation.signed_artifact.signature,
        hash: investigation.signed_artifact.sha256,
      },
    };
  }

  // Cleanup and resource management
  async cleanup(): Promise<void> {
    console.log('Shutting down MCP clients...');
    
    for (const [name, client] of this.clients) {
      try {
        await client.close();
        console.log(`Closed ${name} client`);
      } catch (error) {
        console.error(`Error closing ${name} client:`, error);
      }
    }
    
    this.clients.clear();
  }
}