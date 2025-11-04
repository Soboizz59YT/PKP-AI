import React, { useState, useEffect, useCallback } from 'react';
import ChatView from './components/ChatView';
import PresentationView from './components/PresentationView';
import { NewChatIcon, PkpIcon, AiIcon, CloseIcon, MenuIcon } from './components/icons';
import type { ChatSession, Message, Source } from './types';
import { generateTitle } from './services/geminiService';

const App: React.FC = () => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [presentationContent, setPresentationContent] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const handleResize = () => setIsSidebarOpen(!mediaQuery.matches);
    handleResize(); // Set initial state
    mediaQuery.addEventListener('change', handleResize);
    return () => mediaQuery.removeEventListener('change', handleResize);
  }, []);

  useEffect(() => {
    let loadedSessions: ChatSession[] = [];
    try {
      const savedSessions = localStorage.getItem('chatSessions');
      if (savedSessions) {
        loadedSessions = JSON.parse(savedSessions);
      }
    } catch (e) { 
        console.error("Failed to parse sessions from local storage", e);
    }
    
    if (loadedSessions.length > 0) {
      setSessions(loadedSessions);
      const savedActiveId = localStorage.getItem('activeSessionId');
      if (savedActiveId && loadedSessions.some(s => s.id === savedActiveId)) {
        setActiveSessionId(savedActiveId);
      } else {
        setActiveSessionId(loadedSessions[0].id);
      }
    } else {
      // If no sessions exist, create a new one to start.
      const newSession: ChatSession = { id: Date.now().toString(), title: 'New Chat', messages: [], createdAt: new Date().toISOString() };
      setSessions([newSession]);
      setActiveSessionId(newSession.id);
    }
  }, []);

  useEffect(() => {
    try {
      if (sessions.length > 0) {
        localStorage.setItem('chatSessions', JSON.stringify(sessions));
      } else {
        localStorage.removeItem('chatSessions');
      }
      if (activeSessionId) {
        localStorage.setItem('activeSessionId', activeSessionId);
      }
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)) {
        console.warn("LocalStorage quota exceeded. Removing the oldest session to make space.");
        
        // Sort sessions by date to find the oldest one
        const sortedSessions = [...sessions].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        
        if (sortedSessions.length > 0) {
          const oldestSessionId = sortedSessions[0].id;
          const prunedSessions = sessions.filter(s => s.id !== oldestSessionId);
          
          // If the active session was the one we just deleted, select the new latest session as active.
          if (activeSessionId === oldestSessionId) {
            const newestFirst = prunedSessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setActiveSessionId(newestFirst.length > 0 ? newestFirst[0].id : null);
          }
          
          // This state update will trigger the useEffect again to retry saving the pruned list.
          setSessions(prunedSessions);
        }
      } else {
        console.error("Failed to save sessions to local storage", error);
      }
    }
  }, [sessions, activeSessionId]);

  const handleStartPresentation = useCallback((htmlContent: string) => {
    setPresentationContent(htmlContent);
  }, []);


  const createNewSession = () => {
    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: 'New Chat',
      messages: [],
      createdAt: new Date().toISOString(),
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  };
  
  const updateSession = useCallback(async (sessionId: string, updates: Partial<ChatSession>) => {
    const sessionToUpdate = sessions.find(s => s.id === sessionId);
    if (!sessionToUpdate) return;
    
    // Check if we are adding the very first message from the user.
    const isFirstUserMessage = sessionToUpdate.messages.length === 0 && updates.messages && updates.messages.length > 0 && updates.messages[0].role === 'user';
    
    let finalUpdates = { ...updates };
    if (isFirstUserMessage) {
        const firstPrompt = updates.messages![0].content;
        const newTitle = await generateTitle(firstPrompt);
        finalUpdates.title = newTitle;
    }

    setSessions((prevSessions) =>
      prevSessions.map((session) =>
        session.id === sessionId ? { ...session, ...finalUpdates } : session
      )
    );
  }, [sessions]);

  const streamToSession = useCallback((sessionId: string, messageId: string, chunk: { text?: string; sources?: Source[] }) => {
    setSessions(prev => prev.map(s => {
        if (s.id !== sessionId) return s;
        const newMessages = s.messages.map(m => {
            if (m.id !== messageId) return m;
            const newContent = m.content + (chunk.text || '');
            const newSources = chunk.sources || m.sources;
            return { ...m, content: newContent, sources: newSources };
        });
        return { ...s, messages: newMessages };
    }));
  }, []);

  const updateMessageInSession = useCallback((sessionId: string, messageId: string, updates: Partial<Message>) => {
      setSessions(prev => prev.map(s => {
          if (s.id !== sessionId) return s;
          const newMessages = s.messages.map(m => {
              if (m.id !== messageId) return m;
              return { ...m, ...updates };
          });
          return { ...s, messages: newMessages };
      }));
  }, []);


  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isInitialView = activeSession?.messages.length === 0;

  if (presentationContent) {
    return <PresentationView htmlContent={presentationContent} onExit={() => setPresentationContent(null)} />;
  }

  return (
    <div className="relative h-screen font-sans bg-black flex overflow-hidden">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-30 w-64 bg-gray-900/90 backdrop-blur-sm text-white flex flex-col transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 border-b border-gray-800 flex justify-between items-center">
           <div className="flex items-center gap-2">
              <div className="p-1.5 bg-indigo-600 rounded-lg shadow-[0_0_10px_rgba(129,140,248,0.5)]">
                <PkpIcon />
              </div>
              <h1 className="text-xl font-bold">PKP.ai</h1>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="p-1 text-gray-400 hover:text-white md:hidden" aria-label="Close sidebar">
                <CloseIcon className="w-6 h-6"/>
            </button>
        </div>
        <div className="p-2">
            <button onClick={createNewSession} className="w-full flex items-center justify-center gap-2 p-2 rounded-md bg-indigo-600 hover:bg-indigo-500 transition-colors shadow-lg hover:shadow-indigo-500/50">
                <NewChatIcon className="w-5 h-5" />
                New Chat
            </button>
        </div>
        <nav className="flex-grow overflow-y-auto p-2 space-y-1">
          {sessions.map((session) => (
            <a
              key={session.id}
              href="#"
              onClick={(e) => {
                  e.preventDefault();
                  setActiveSessionId(session.id);
                  if (window.innerWidth < 768) {
                    setIsSidebarOpen(false);
                  }
              }}
              className={`block w-full text-left px-3 py-2 rounded-md text-sm truncate transition-colors ${
                session.id === activeSessionId ? 'bg-gray-700' : 'hover:bg-gray-800'
              }`}
            >
              {session.title}
            </a>
          ))}
        </nav>
      </aside>

      {/* Mobile Overlay */}
      {isSidebarOpen && <div onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 bg-black/60 z-20 md:hidden" />}

      <main className="flex-1 min-w-0">
        {/* Mobile Menu Button */}
        <button 
            onClick={() => setIsSidebarOpen(true)} 
            className={`fixed top-4 left-4 z-10 p-2 bg-gray-800/50 rounded-md backdrop-blur-sm text-white hover:bg-gray-700 transition-opacity duration-300 md:hidden ${isSidebarOpen || isInitialView ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
            aria-label="Open sidebar"
          >
            <MenuIcon className="w-6 h-6" />
        </button>
        
        {activeSession ? (
          <ChatView 
              session={activeSession} 
              updateSession={updateSession} 
              streamToSession={streamToSession} 
              updateMessageInSession={updateMessageInSession}
              onStartPresentation={handleStartPresentation} 
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gray-900/50">
            <AiIcon className="w-12 h-12 text-gray-600 animate-pulse"/>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;