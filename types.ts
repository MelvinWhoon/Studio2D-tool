
export interface FurnitureChoice {
  id: string; // unique id for this specific instance
  type: string; // e.g. 'bank', 'stoel'
  product?: string;
  color?: string;
  referenceImage?: string | null;
  skip: boolean;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface GenerationState {
  isGenerating: boolean;
  isGeneratingMoodboard: boolean;
  isDetectingFurniture: boolean;
  error: string | null;
  originalImage: string | null;
  resultImage: string | null;
  projectTitle: string;
  pinterestLink: string;
  moodboardSourceImages: string[];
  moodboardResultImages: string[]; 
  progressMessage: string;
  detectedFurniture: FurnitureChoice[];
  refinementChat: ChatMessage[];
  currentAnnotation: string | null;
  floorPlanDescription: string | null;
  lastGeneratedMode: '2D' | '2.5D';
}

export type AppTab = 'plattegrond' | 'moodboard';
