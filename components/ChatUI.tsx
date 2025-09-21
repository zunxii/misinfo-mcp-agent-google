'use client';

import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Loader2, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Eye,
  Download,
  Play,
  Pause,
  ExternalLink,
  Shield,
  Brain,
  Image as ImageIcon,
  Video,
  FileText
} from 'lucide-react';

interface EvidenceItem {
  id: string;
  type: 'fact_check' | 'forensic' | 'web_search' | 'reverse_image' | 'archive';
  source: string;
  content: string;
  confidence: number;
  timestamp: string;
  metadata: any;
}

interface TimelineEvent {
  timestamp: string;
  event_type: 'first_appearance' | 'modification' | 'spread' | 'fact_check';
  description: string;
  source: string;
  confidence: number;
  media_snapshot?: string;
}

interface InvestigationResult {
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

export default function ChatUI() {
  const [messages, setMessages] = useState<Array<{
    id: string;
    type: 'user' | 'assistant';
    content: string;
    result?: InvestigationResult;
    timestamp: Date;
  }>>([]);
  
  const [input, setInput] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [investigationType, setInvestigationType] = useState<'fact_check' | 'media_analysis' | 'full_investigation'>('full_investigation');
  const [activeTab, setActiveTab] = useState<'evidence' | 'timeline' | 'forensics' | 'lesson'>('evidence');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && !mediaFile && !mediaUrl) return;

    setIsLoading(true);
    
    const userMessage = {
      id: Date.now().toString(),
      type: 'user' as const,
      content: input || 'Media analysis request',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);

    try {
      // Prepare the investigation request
      const requestData = {
        type: investigationType,
        content: {
          claim: input || undefined,
          media_url: mediaUrl || undefined,
          context: `User submitted ${investigationType} request`,
        },
        options: {
          include_forensics: true,
          generate_lesson: true,
          create_timeline: true,
        },
      };

      // Handle file upload if present
      if (mediaFile) {
        // In a real implementation, you'd upload the file and get a URL
        const mockUrl = `https://example.com/uploads/${mediaFile.name}`;
        requestData.content.media_url = mockUrl;
      }

      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });

      const result: InvestigationResult = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Investigation failed');
      }

      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant' as const,
        content: result.explanation,
        result,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);

    } catch (error) {
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant' as const,
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      setInput('');
      setMediaFile(null);
      setMediaUrl('');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setMediaFile(file);
      setMediaUrl(''); // Clear URL if file is selected
    }
  };

  const getVerdictIcon = (verdict: string) => {
    switch (verdict) {
      case 'TRUE':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'FALSE':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'MIXED':
        return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
      default:
        return <Clock className="h-5 w-5 text-gray-600" />;
    }
  };

  const getVerdictColor = (verdict: string) => {
    switch (verdict) {
      case 'TRUE':
        return 'bg-green-100 border-green-300 text-green-800';
      case 'FALSE':
        return 'bg-red-100 border-red-300 text-red-800';
      case 'MIXED':
        return 'bg-yellow-100 border-yellow-300 text-yellow-800';
      default:
        return 'bg-gray-100 border-gray-300 text-gray-800';
    }
  };

  const downloadEvidence = async (result: InvestigationResult) => {
    try {
      const response = await fetch(`/api/agent?action=export&id=${result.id}`);
      const blob = await response.blob();
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `investigation-${result.id}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  const renderEvidenceChain = (evidence: EvidenceItem[]) => (
    <div className="space-y-3">
      {evidence.map((item, index) => (
        <div key={item.id} className="border rounded-lg p-4 bg-white">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                item.type === 'fact_check' ? 'bg-blue-600' :
                item.type === 'forensic' ? 'bg-purple-600' :
                item.type === 'web_search' ? 'bg-green-600' :
                item.type === 'reverse_image' ? 'bg-orange-600' :
                'bg-gray-600'
              }`}>
                {index + 1}
              </div>
              <span className="font-medium text-sm capitalize">{item.type.replace('_', ' ')}</span>
              <div className={`px-2 py-1 rounded text-xs font-medium ${
                item.confidence > 0.8 ? 'bg-green-100 text-green-800' :
                item.confidence > 0.6 ? 'bg-yellow-100 text-yellow-800' :
                'bg-red-100 text-red-800'
              }`}>
                {Math.round(item.confidence * 100)}% confidence
              </div>
            </div>
            <span className="text-xs text-gray-500">
              {new Date(item.timestamp).toLocaleString()}
            </span>
          </div>
          
          <p className="text-sm text-gray-700 mb-2">{item.content}</p>
          
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Source: {item.source}</span>
            {item.source.startsWith('http') && (
              <a 
                href={item.source} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center space-x-1 text-blue-600 hover:text-blue-800"
              >
                <ExternalLink className="h-3 w-3" />
                <span>View</span>
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  const renderTimeline = (timeline: TimelineEvent[]) => (
    <div className="space-y-4">
      {timeline.map((event, index) => (
        <div key={index} className="flex items-start space-x-4">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            event.event_type === 'first_appearance' ? 'bg-blue-100 text-blue-600' :
            event.event_type === 'modification' ? 'bg-red-100 text-red-600' :
            event.event_type === 'spread' ? 'bg-yellow-100 text-yellow-600' :
            'bg-green-100 text-green-600'
          }`}>
            {event.event_type === 'first_appearance' && <Eye className="h-4 w-4" />}
            {event.event_type === 'modification' && <AlertTriangle className="h-4 w-4" />}
            {event.event_type === 'spread' && <Eye className="h-4 w-4" />}
            {event.event_type === 'fact_check' && <Shield className="h-4 w-4" />}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-900 capitalize">
                {event.event_type.replace('_', ' ')}
              </p>
              <span className="text-xs text-gray-500">
                {new Date(event.timestamp).toLocaleString()}
              </span>
            </div>
            
            <p className="text-sm text-gray-600 mt-1">{event.description}</p>
            
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-500">Source: {event.source}</span>
              <div className={`px-2 py-1 rounded text-xs font-medium ${
                event.confidence > 0.8 ? 'bg-green-100 text-green-800' :
                event.confidence > 0.6 ? 'bg-yellow-100 text-yellow-800' :
                'bg-red-100 text-red-800'
              }`}>
                {Math.round(event.confidence * 100)}%
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderForensics = (forensics: any) => {
    if (!forensics) return <p className="text-gray-500">No forensic analysis available</p>;

    return (
      <div className="space-y-4">
        <div className="bg-white border rounded-lg p-4">
          <h4 className="font-medium text-sm mb-3 flex items-center">
            <Brain className="h-4 w-4 mr-2" />
            Analysis Summary
          </h4>
          
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <span className="text-xs text-gray-500">Tampering Probability</span>
              <div className="mt-1">
                <div className={`text-lg font-bold ${
                  (forensics.tampering_probability || forensics.manipulationProbability || 0) > 0.7 ? 'text-red-600' :
                  (forensics.tampering_probability || forensics.manipulationProbability || 0) > 0.3 ? 'text-yellow-600' :
                  'text-green-600'
                }`}>
                  {Math.round((forensics.tampering_probability || forensics.manipulationProbability || 0) * 100)}%
                </div>
              </div>
            </div>
            
            {forensics.duration && (
              <div>
                <span className="text-xs text-gray-500">Duration</span>
                <div className="mt-1 text-lg font-bold text-gray-700">
                  {Math.round(forensics.duration)}s
                </div>
              </div>
            )}
          </div>

          {forensics.suspicious_frames && forensics.suspicious_frames.length > 0 && (
            <div>
              <span className="text-xs text-gray-500">Suspicious Frames</span>
              <div className="mt-2 space-y-2">
                {forensics.suspicious_frames.slice(0, 3).map((frame: any, index: number) => (
                  <div key={index} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                    <span className="text-sm">Frame {frame.frameIndex} ({frame.timestamp.toFixed(1)}s)</span>
                    <span className="text-xs text-red-600 font-medium">
                      {Math.round(frame.suspicionScore * 100)}% suspicious
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {forensics.techniques_detected && forensics.techniques_detected.length > 0 && (
            <div className="mt-4">
              <span className="text-xs text-gray-500">Techniques Detected</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {forensics.techniques_detected.map((technique: string, index: number) => (
                  <span key={index} className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded">
                    {technique.replace('_', ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderMicroLesson = (lesson: any) => {
    if (!lesson) return <p className="text-gray-500">No micro-lesson available</p>;

    return (
      <div className="bg-white border rounded-lg p-4">
        <h4 className="font-medium mb-2 flex items-center">
          <Brain className="h-4 w-4 mr-2 text-purple-600" />
          Learn: {lesson.technique}
        </h4>
        
        <p className="text-sm text-gray-700 mb-4">{lesson.explanation}</p>
        
        <div className="space-y-3">
          {lesson.interactive_elements?.map((element: any, index: number) => (
            <div key={index} className="border rounded p-3 bg-purple-50">
              <div className="flex items-center mb-2">
                {element.type === 'question' && <span className="text-purple-600 font-medium text-sm">Question:</span>}
                {element.type === 'visual_comparison' && <span className="text-purple-600 font-medium text-sm">Visual:</span>}
              </div>
              
              <p className="text-sm text-gray-700">{element.content}</p>
              
              {element.correct_answer && (
                <details className="mt-2">
                  <summary className="text-xs text-purple-600 cursor-pointer hover:text-purple-800">
                    Show Answer
                  </summary>
                  <p className="text-xs text-gray-600 mt-1 pl-4 border-l-2 border-purple-200">
                    {element.correct_answer}
                  </p>
                </details>
              )}
            </div>
          ))}
        </div>
        
        <div className="mt-4 text-xs text-gray-500 flex items-center">
          <Clock className="h-3 w-3 mr-1" />
          Estimated time: {lesson.duration_seconds}s
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3">
        <h1 className="text-xl font-bold text-gray-900">AI Misinformation Detector</h1>
        <p className="text-sm text-gray-600">Fact-check claims and analyze media with evidence-backed investigations</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="bg-white rounded-lg p-6 max-w-md mx-auto border">
              <Shield className="h-12 w-12 text-blue-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Welcome to AI Fact-Checker</h3>
              <p className="text-gray-600 text-sm mb-4">
                Submit claims, URLs, or media files for comprehensive fact-checking and forensic analysis.
              </p>
              <div className="text-left space-y-2 text-xs text-gray-500">
                <div className="flex items-center">
                  <CheckCircle className="h-3 w-3 mr-2 text-green-600" />
                  Evidence-backed analysis
                </div>
                <div className="flex items-center">
                  <Shield className="h-3 w-3 mr-2 text-blue-600" />
                  Forensic media examination
                </div>
                <div className="flex items-center">
                  <Brain className="h-3 w-3 mr-2 text-purple-600" />
                  Interactive learning modules
                </div>
              </div>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-4xl w-full ${message.type === 'user' ? 'ml-4' : 'mr-4'}`}>
              <div className={`rounded-lg p-4 ${
                message.type === 'user' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-white border'
              }`}>
                <p className="text-sm">{message.content}</p>
                
                {message.result && (
                  <div className="mt-4 space-y-4">
                    {/* Verdict Card */}
                    <div className={`border-2 rounded-lg p-4 ${getVerdictColor(message.result.verdict)}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          {getVerdictIcon(message.result.verdict)}
                          <span className="font-bold text-lg">{message.result.verdict}</span>
                        </div>
                        <div className="text-sm">
                          {Math.round(message.result.confidence * 100)}% confidence
                        </div>
                      </div>
                      
                      {message.result.processing_time_ms && (
                        <div className="text-xs opacity-75">
                          Analysis completed in {message.result.processing_time_ms}ms
                        </div>
                      )}
                    </div>

                    {/* Tab Navigation */}
                    <div className="border-b">
                      <nav className="flex space-x-8">
                        {[
                          { id: 'evidence', label: 'Evidence', icon: FileText },
                          { id: 'timeline', label: 'Timeline', icon: AlertTriangle },
                          { id: 'forensics', label: 'Forensics', icon: Eye },
                          { id: 'lesson', label: 'Learn', icon: Brain },
                        ].map((tab) => (
                          <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm ${
                              activeTab === tab.id
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            <tab.icon className="h-4 w-4" />
                            <span>{tab.label}</span>
                            {tab.id === 'evidence' && (
                              <span className="bg-gray-200 text-gray-600 px-2 py-1 rounded-full text-xs">
                                {message.result!.evidence_chain.length}
                              </span>
                            )}
                          </button>
                        ))}
                      </nav>
                    </div>

                    {/* Tab Content */}
                    <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto">
                      {activeTab === 'evidence' && renderEvidenceChain(message.result.evidence_chain)}
                      {activeTab === 'timeline' && message.result.timeline && renderTimeline(message.result.timeline)}
                      {activeTab === 'forensics' && renderForensics(message.result.forensic_analysis)}
                      {activeTab === 'lesson' && renderMicroLesson(message.result.micro_lesson)}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex space-x-2">
                      <button
                        onClick={() => downloadEvidence(message.result!)}
                        className="flex items-center space-x-1 px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                      >
                        <Download className="h-3 w-3" />
                        <span>Export Evidence</span>
                      </button>
                      
                      {message.result.signed_artifact.exportable_json_ld && (
                        <button className="flex items-center space-x-1 px-3 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700">
                          <Shield className="h-3 w-3" />
                          <span>Share Verified</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="text-xs text-gray-500 mt-1 px-2">
                {message.timestamp.toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <div className="bg-white border-t p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Investigation Type Selector */}
          <div className="flex space-x-2">
            {[
              { value: 'fact_check', label: 'Fact Check', icon: FileText },
              { value: 'media_analysis', label: 'Media Analysis', icon: Video },
              { value: 'full_investigation', label: 'Full Investigation', icon: Shield },
            ].map((type) => (
              <button
                key={type.value}
                type="button"
                onClick={() => setInvestigationType(type.value as any)}
                className={`flex items-center space-x-1 px-3 py-2 rounded text-sm font-medium ${
                  investigationType === type.value
                    ? 'bg-blue-100 text-blue-800 border border-blue-300'
                    : 'bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200'
                }`}
              >
                <type.icon className="h-4 w-4" />
                <span>{type.label}</span>
              </button>
            ))}
          </div>

          {/* Media Input */}
          <div className="flex space-x-2">
            <input
              type="text"
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder="Media URL (image/video)"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center space-x-2"
            >
              <ImageIcon className="h-4 w-4" />
              <span>Upload</span>
            </button>
            
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Show selected file */}
          {mediaFile && (
            <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-2">
              <div className="flex items-center space-x-2">
                {mediaFile.type.startsWith('video/') ? (
                  <Video className="h-4 w-4 text-blue-600" />
                ) : (
                  <ImageIcon className="h-4 w-4 text-blue-600" />
                )}
                <span className="text-sm text-blue-800">{mediaFile.name}</span>
                <span className="text-xs text-blue-600">
                  ({Math.round(mediaFile.size / 1024)}KB)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMediaFile(null)}
                className="text-blue-600 hover:text-blue-800"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Main Input */}
          <div className="flex space-x-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                investigationType === 'fact_check' 
                  ? "Enter a claim to fact-check..."
                  : investigationType === 'media_analysis'
                  ? "Describe the media or leave blank for automatic analysis..."
                  : "Enter claim or describe media for full investigation..."
              }
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isLoading}
            />
            
            <button
              type="submit"
              disabled={isLoading || (!input.trim() && !mediaFile && !mediaUrl)}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Analyzing...</span>
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  <span>Investigate</span>
                </>
              )}
            </button>
          </div>

          {/* Helper Text */}
          <div className="text-xs text-gray-500 space-y-1">
            <p>
              <strong>Tip:</strong> 
              {investigationType === 'fact_check' && " Enter any claim you want to verify. We'll search fact-checkers and gather evidence."}
              {investigationType === 'media_analysis' && " Upload or link to images/videos for forensic analysis and reverse search."}
              {investigationType === 'full_investigation' && " Combine claim checking with media analysis for comprehensive verification."}
            </p>
            <p>
              Supported formats: JPG, PNG, GIF, MP4, AVI, MOV • Max file size: 50MB
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}