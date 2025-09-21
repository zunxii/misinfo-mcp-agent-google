import fetch from 'node-fetch';

export interface GoogleFactCheckClaim {
  claimReview?: Array<{
    publisher?: { name?: string };
    reviewDate?: string;
    textualRating?: string;
    url?: string;
  }>;
}

export class GoogleFactCheckService {
  constructor(private apiKey?: string) {}

  async search(claim: string, language: string = 'en'): Promise<GoogleFactCheckClaim[]> {
    if (!this.apiKey) {
      console.warn('Google FactCheck API key not provided, using mock data');
      return [];
    }

    try {
      const encodedClaim = encodeURIComponent(claim);
      const url = `https://factchecktools.googleapis.com/v1alpha1/claims:search?query=${encodedClaim}&languageCode=${language}&key=${this.apiKey}`;
      
      const response = await fetch(url);
      const data = await response.json() as any;
      
      return data.claims || [];
    } catch (error) {
      console.error('Google FactCheck API error:', error);
      return [];
    }
  }
}
