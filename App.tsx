
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ChatView from './components/ChatView';
import { NewChatIcon, PkpIcon, AiIcon, CloseIcon, MenuIcon, MoreVerticalIcon, EditIcon, TrashIcon, CheckIcon } from './components/icons';
import type { ChatSession, Message, Source } from './types';
import { generateTitle } from './services/geminiService';

const App: React.FC = () => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string | null>(null);
  const [tempTitle, setTempTitle] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const handleResize = () => setIsSidebarOpen(!mediaQuery.matches);
    handleResize(); // Set initial state
    mediaQuery.addEventListener('change', handleResize);
    return () => mediaQuery.removeEventListener('change', handleResize);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
            setOpenMenuSessionId(null);
        }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const createNewSession = useCallback(() => {
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
      createNewSession();
    }
  }, [createNewSession]);

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
        
        const sortedSessions = [...sessions].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        
        if (sortedSessions.length > 0) {
          const oldestSessionId = sortedSessions[0].id;
          const prunedSessions = sessions.filter(s => s.id !== oldestSessionId);
          
          if (activeSessionId === oldestSessionId) {
            const newestFirst = prunedSessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setActiveSessionId(newestFirst.length > 0 ? newestFirst[0].id : null);
          }
          
          setSessions(prunedSessions);
        }
      } else {
        console.error("Failed to save sessions to local storage", error);
      }
    }
  }, [sessions, activeSessionId]);
  
  // Effect for auto-generating title for new chats
  useEffect(() => {
    const renameSessionIfNeeded = async () => {
        const sessionToUpdate = sessions.find(s => s.id === activeSessionId);
        
        // Auto-rename if it's a new chat with its first user message and placeholder.
        if (sessionToUpdate && sessionToUpdate.title === 'New Chat' && sessionToUpdate.messages.length === 2 && sessionToUpdate.messages[0].role === 'user') {
            const firstPrompt = sessionToUpdate.messages[0].content;
            if (firstPrompt) {
                const newTitle = await generateTitle(firstPrompt);
                setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, title: newTitle } : s));
            }
        }
    };
    renameSessionIfNeeded();
  }, [sessions, activeSessionId]);
  
  const updateSession = useCallback((sessionId: string, updates: Partial<ChatSession>) => {
    setSessions((prevSessions) =>
      prevSessions.map((session) =>
        session.id === sessionId ? { ...session, ...updates } : session
      )
    );
  }, []);

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

  const handleCancelGeneration = (sessionId: string) => {
    setSessions(prev => prev.map(s => {
        if (s.id !== sessionId) return s;
        // Filter out any messages that are currently in-progress
        return { ...s, messages: s.messages.filter(m => m.status !== 'in-progress') };
    }));
  };

  const handleDeleteSession = (sessionIdToDelete: string) => {
    if (!window.confirm("Are you sure you want to delete this chat? This action cannot be undone.")) return;
    
    const newSessions = sessions.filter(s => s.id !== sessionIdToDelete);

    if (newSessions.length === 0) {
        createNewSession();
    } else {
        if (activeSessionId === sessionIdToDelete) {
            setActiveSessionId(newSessions[0].id);
        }
        setSessions(newSessions);
    }
  };
  
  const handleStartRename = (session: ChatSession) => {
    setRenamingSessionId(session.id);
    setTempTitle(session.title);
    setOpenMenuSessionId(null);
  };
  
  const handleSaveRename = (sessionId: string) => {
    if (tempTitle.trim()) {
        setSessions(prev =>
            prev.map(s => (s.id === sessionId ? { ...s, title: tempTitle.trim() } : s))
        );
    }
    setRenamingSessionId(null);
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isInitialView = activeSession?.messages.length === 0;

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
        <nav className="flex-grow overflow-y-auto p-2 space-y-1 pb-40">
          {sessions.map((session) => (
            <div key={session.id} className="relative group">
              {renamingSessionId === session.id ? (
                <div className="flex items-center gap-2 p-1">
                  <input
                    type="text"
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRename(session.id);
                        if (e.key === 'Escape') setRenamingSessionId(null);
                    }}
                    onBlur={() => handleSaveRename(session.id)}
                    className="w-full bg-gray-600 text-white px-2 py-1.5 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    autoFocus
                  />
                  <button onClick={() => handleSaveRename(session.id)} className="p-1 text-gray-300 hover:text-white">
                      <CheckIcon className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <a
                  href="#"
                  onClick={(e) => {
                      e.preventDefault();
                      setActiveSessionId(session.id);
                      if (window.innerWidth < 768) {
                        setIsSidebarOpen(false);
                      }
                  }}
                  className={`block w-full text-left pl-3 pr-8 py-2 rounded-md text-sm truncate transition-colors ${
                    session.id === activeSessionId ? 'bg-gray-700' : 'hover:bg-gray-800'
                  }`}
                >
                  {session.title}
                </a>
              )}
              {renamingSessionId !== session.id && (
                <div className="absolute top-1/2 -translate-y-1/2 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setOpenMenuSessionId(session.id === openMenuSessionId ? null : session.id)} className="p-1 text-gray-400 hover:text-white rounded-md">
                    <MoreVerticalIcon className="w-4 h-4" />
                  </button>
                  {openMenuSessionId === session.id && (
                    <div ref={menuRef} className="absolute top-full mt-1 right-0 w-32 bg-gray-950/80 backdrop-blur-md border border-gray-700 rounded-lg shadow-2xl z-10 animate-fade-in-up">
                      <button onClick={(e) => { e.stopPropagation(); handleStartRename(session); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-800 transition-colors rounded-t-lg">
                          <EditIcon className="w-4 h-4" /> Rename
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-red-400 hover:bg-gray-800 transition-colors rounded-b-lg">
                          <TrashIcon className="w-4 h-4" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
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
              onCancelGeneration={handleCancelGeneration}
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
