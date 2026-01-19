
export interface Source {
  uri: string;
  title: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type: 'text' | 'image' | 'loading' | 'error';
  sources?: Source[];
  timestamp: string;
  status?: 'in-progress' | 'complete';
  mode?: 'text' | 'image' | 'presentation';
  attachment?: {
    data: string; // base64 encoded data
    mimeType: string;
  };
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
}