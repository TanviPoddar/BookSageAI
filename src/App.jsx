import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Loader2, Upload, Book, FileText, MessageSquare, History, PlusCircle, X, Settings,Mic } from "lucide-react";
import supabase from "./supabase";

// Embedding generation function
async function generateEmbedding(text) {
  try {
    const response = await fetch("http://localhost:5000/embed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
    
    if (!response.ok) {
      throw new Error(`Error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.embedding;
  } catch (error) {
    console.error("Error generating embedding:", error);
    throw error;
  }
}

// Vector search function
async function performVectorSearch(embedding, query_text, documentId = null, limit = 10) {
  try {
    let query = supabase
      .rpc('hybrid_search', {
        query_text: query_text,
        query_embedding: embedding,
        match_count: limit
      });
    
    if (documentId) {
      query = query.eq('document_id', documentId);
    }
    
    const { data, error } = await query;
    
    if (error) {
      throw error;
    }
    
    return data;
  } catch (error) {
    console.error("Error performing vector search:", error);
    throw error;
  }
}

async function generateGeminiAnswer(userQuery, contextData, documentName = null) {
  try {
    const response = await fetch("http://localhost:5000/generate-answer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        query: userQuery,
        context: contextData,
        documentName: documentName 
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.answer;
  } catch (error) {
    console.error("Error generating Gemini answer:", error);
    throw error;
  }
}

async function saveChatHistory(messages, documentId = null) {
  if (!messages.length) return null;
  
  try {
    // Get a title from the first user message or use default
    const firstUserMsg = messages.find(msg => msg.sender === 'user');
    const chatTitle = firstUserMsg 
      ? firstUserMsg.text.substring(0, 30) + (firstUserMsg.text.length > 30 ? '...' : '') 
      : 'New Chat';
    
    // Insert chat metadata - let Supabase generate the UUID
    const { data: chatData, error: chatError } = await supabase
      .from('chats')
      .insert({
        title: chatTitle,
        document_id: documentId
      })
      .select();
      
    if (chatError) throw chatError;
    
    // Get the server-generated chat ID
    const chatId = chatData[0].id;
    
    // Insert all messages as a batch - let Supabase generate UUIDs
    const messageEntries = messages.map(msg => ({
      chat_id: chatId,
      text: msg.text,
      sender: msg.sender
    }));
    
    const { error: messagesError } = await supabase
      .from('chat_messages')
      .insert(messageEntries);
      
    if (messagesError) throw messagesError;
    
    return {
      id: chatId,
      title: chatTitle,
      date: new Date().toLocaleDateString()
    };
  } catch (error) {
    console.error("Error saving chat history:", error);
    return null;
  }
}

async function loadChatHistory() {
  try {
    const { data, error } = await supabase
      .from('chats')
      .select(`
        id,
        title,
        created_at,
        document_id,
        documents(title)
      `)
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    return data.map(chat => ({
      id: chat.id,
      title: chat.title,
      date: new Date(chat.created_at).toLocaleDateString(),
      documentId: chat.document_id,
      documentTitle: chat.documents?.title
    }));
  } catch (error) {
    console.error("Error loading chat history:", error);
    return [];
  }
}


async function loadChatMessages(chatId) {
  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
      
    if (error) throw error;
    
    return data.map(msg => ({
      text: msg.text,
      sender: msg.sender
    }));
  } catch (error) {
    console.error("Error loading chat messages:", error);
    return [];
  }
}


export default function BookSageAI() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [activeDocument, setActiveDocument] = useState(null);
  const [activeDocumentId, setActiveDocumentId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [documents, setDocuments] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [isListening, setIsListening] = useState(false);

  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    // Initialize speech recognition
    if ('webkitSpeechRecognition' in window) {
      const recognition = new window.webkitSpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setIsListening(false);
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in your browser');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  //load chat history

  useEffect(() => {
    async function fetchChatHistory() {
      const history = await loadChatHistory();
      setChatHistory(history);
    }
    
    fetchChatHistory();
  }, []);

  const loadChat = async (chatId) => {
    const chatMessages = await loadChatMessages(chatId);
    if (chatMessages.length > 0) {
      setMessages(chatMessages);
      
      // Find the chat to get document info if available
      const selectedChat = chatHistory.find(chat => chat.id === chatId);
      if (selectedChat && selectedChat.documentId) {
        setActiveDocumentId(selectedChat.documentId);
        setActiveDocument(selectedChat.documentTitle || "Document");
      }
    }
  };

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    
    const newMessage = { text: input, sender: "user" };
    setMessages([...messages, newMessage]);
    setInput("");
    
    setLoading(true);
    
    try {
      // Generate embedding for the user's query
      const embedding = await generateEmbedding(input);
      
      // Perform vector search in Supabase
      const searchResults = await performVectorSearch(
        embedding, 
        input, 
        activeDocumentId
      );
      
      // If no results found
      if (!searchResults || searchResults.length === 0) {
        setMessages(prev => [
          ...prev,
          { 
            text: activeDocument 
              ? `I couldn't find relevant information about "${input}" in the document "${activeDocument}".` 
              : "I don't have enough information to answer that question. Please upload a document first.",
            sender: "bot" 
          }
        ]);
      } else {
        const contextData = searchResults.map(item => item.content).join('\n\n');
        
        const geminiAnswer = await generateGeminiAnswer(input, contextData, activeDocument);
        
        setMessages(prev => [
          ...prev,
          { 
            text: geminiAnswer,
            sender: "bot" 
          }
        ]);
      }
    } catch (error) {
      console.error("Error in vector search or answer generation process:", error);
      setMessages(prev => [
        ...prev,
        { 
          text: "I encountered an error while processing your request. Please try again.",
          sender: "bot" 
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleFileUpload = async () => {
    if (!selectedFile) return;
  
    console.log("Uploading file:", selectedFile);
  
    setMessages((prev) => [
      ...prev,
      { text: `Uploaded file: ${selectedFile.name}`, sender: "user" },
    ]);
  
    setLoading(true);
  
    const formData = new FormData();
    formData.append("file", selectedFile);
  
    try {
      // Send file to backend for processing, chunking, embedding, and storing in Supabase
      const response = await fetch("http://localhost:5000/upload", {
        method: "POST",
        body: formData,
      });
  
      const data = await response.json();
      console.log("Server Response:", data);
  
      if (data.error) {
        throw new Error(data.error);
      }
      
      // Update state with the document info from the server
      setActiveDocument(selectedFile.name);

      setMessages((prev) => [
        ...prev,
        {
          text: `I've analyzed "${selectedFile.name}" and indexed its contents. What would you like to know about this document?`,
          sender: "bot",
        },
      ]);
  
      // Add to documents list if not already present
      if (!documents.some((doc) => doc.id === data.document.id)) {
        setDocuments((prev) => [
          ...prev,
          { 
            name: selectedFile.name, 
            date: new Date().toLocaleDateString() 
          },
        ]);
      }
    } catch (error) {
      console.error("Error:", error);
      setMessages((prev) => [
        ...prev,
        { text: "Failed to process the document. Please try again.", sender: "bot" },
      ]);
    }
  
    setLoading(false);
    setSelectedFile(null);
  };
  
  const startNewChat = async() => {
    if (messages.length > 0) {
      // Save current chat to database
      const savedChat = await saveChatHistory(messages, activeDocumentId);
      if (savedChat) {
        setChatHistory(prev => [savedChat, ...prev]);
      }
    }
    
    setMessages([]);
    setActiveDocument(null);
    setActiveDocumentId(null);
  };

  const selectDocument = (doc) => {
    setActiveDocument(doc.name);
    setActiveDocumentId(doc.id);
    
    if (messages.length === 0) {
      setMessages([
        { 
          text: `I've loaded "${doc.name}". What would you like to know about this document?`,
          sender: "bot" 
        }
      ]);
    }
  };

  return (
    <div className="h-screen flex overflow-hidden bg-gray-900 text-gray-100">
      {/* Sidebar toggle for mobile */}
      <button 
        className="md:hidden fixed top-4 left-4 z-50 bg-blue-600 text-white p-2 rounded-full shadow-lg"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X className="w-5 h-5" /> : <Settings className="w-5 h-5" />}
      </button>
      
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 transition-transform duration-300 ease-in-out w-80 bg-gray-800 border-r border-gray-700 flex-shrink-0 flex flex-col h-full shadow-lg z-40 md:z-auto fixed md:relative`}>
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center">
            <Book className="w-6 h-6 mr-2 text-blue-400" />
            <h1 className="text-xl font-bold">BookSageAI</h1>
          </div>
        </div>
        
        <div className="p-4">
          <Button 
            className="w-full mb-4 bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center gap-2"
            onClick={startNewChat}
          >
            <PlusCircle className="w-4 h-4" />
            New Chat
          </Button>
        </div>
        
        <div className="flex-grow overflow-auto">
          {/* Documents section */}
          <div className="p-4">
            <h2 className="text-sm uppercase tracking-wider mb-4 font-semibold text-gray-400">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Documents
              </div>
            </h2>
            
            <div className="space-y-2 mb-6">
              <input
                type="file"
                id="file-upload"
                className="hidden"
                onChange={handleFileChange}
              />
              <label 
                htmlFor="file-upload"
                className="block w-full px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded cursor-pointer transition-colors text-center"
              >
                <Upload className="w-4 h-4 inline mr-2" />
                Choose File
              </label>
              
              {selectedFile && (
                <div className="text-sm p-2 bg-blue-900 text-blue-200 rounded flex justify-between items-center">
                  <span className="truncate max-w-[180px]">
                    {selectedFile.name}
                  </span>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="h-6 w-6 p-0 rounded-full"
                    onClick={() => setSelectedFile(null)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              )}
              
              <Button
                onClick={handleFileUpload}
                disabled={!selectedFile}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white"
              >
                Upload & Analyze
              </Button>
            </div>
            
            <div className="space-y-1 mt-2">
              {documents.map((doc) => (
                <div 
                  key={doc.id}
                  className={`p-2 rounded flex justify-between items-center cursor-pointer ${activeDocumentId === doc.id ? 'bg-blue-900/30 text-blue-200' : 'hover:bg-gray-700'}`}
                  onClick={() => selectDocument(doc)}
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileText className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm truncate">{doc.name}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Chat history section */}
          <div className="p-4">
            <h2 className="text-sm uppercase tracking-wider mb-4 font-semibold text-gray-400">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4" />
                Chat History
              </div>
            </h2>
            
            <div className="space-y-1">
              {chatHistory.map((chat) => (
                <div 
                  key={chat.id}
                  className="p-2 rounded flex justify-between items-center cursor-pointer hover:bg-gray-700"
                  onClick={()=>loadChat(chat.id)}
                >
                  <div className="flex items-center gap-2 truncate max-w-[80%]">
                    <MessageSquare className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm truncate">{chat.title}</span>
                  </div>
                  <span className="text-xs opacity-70">{chat.date}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {/* Main chat area */}
      <div className="flex-grow flex flex-col h-full relative">
        {activeDocument && (
          <div className="p-2 bg-blue-900/30 text-blue-200 border-blue-800 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              <span className="text-sm font-medium">Active document: {activeDocument}</span>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-7 rounded-full"
              onClick={() => {
                setActiveDocument(null);
                setActiveDocumentId(null);
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}
        
        <div className="w-full max-w-4xl mx-auto px-4 py-4 flex flex-col h-full">
          {/* Chat messages area */}
          <div className="flex-grow overflow-auto mb-4 px-4 scrollbar-dark">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="p-12 rounded-2xl bg-gray-800 shadow-lg max-w-lg mx-auto mb-8">
                  <Book className="w-16 h-16 mb-6 mx-auto text-blue-400 opacity-80" />
                  <h2 className="text-2xl font-bold mb-4">Welcome to BookSageAI</h2>
                  <p className="mb-6 text-gray-300">
                    Upload any document and ask questions to instantly get insights and answers from its content.
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-left">
                    <div className="p-3 rounded-lg bg-gray-700">
                      <Upload className="w-5 h-5 mb-2 text-blue-400" />
                      <p className="text-sm font-medium">Upload documents</p>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-700">
                      <MessageSquare className="w-5 h-5 mb-2 text-blue-400" />
                      <p className="text-sm font-medium">Ask any question</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-5 py-4">
                {messages.map((msg, index) => (
                  <div
                    key={index}
                    className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`px-4 py-3 rounded-2xl max-w-[85%] ${
                        msg.sender === "user"
                          ? "bg-blue-600 text-white rounded-br-none"
                          : "bg-gray-800 border border-gray-700 rounded-bl-none shadow-sm"
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start mt-2">
                    <div className="px-4 py-3 rounded-2xl max-w-[85%] bg-gray-800 border border-gray-700 rounded-bl-none flex items-center shadow-sm">
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      <span>Processing your request...</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
          
          {/* Input box */}
          <Card className="bg-gray-800 border-gray-700 shadow-sm p-2 mb-4 rounded-xl">
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-center gap-2"
            >
              <Input
                className="flex-grow bg-gray-700 border-gray-600 text-white placeholder:text-gray-400 rounded-lg"
                placeholder={activeDocument ? "Ask about your document..." : "Upload a document or start chatting..."}
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <Button
                type="button"
                className={`${
                  isListening 
                    ? "bg-blue-600 hover:bg-blue-500" 
                    : "bg-gray-700 hover:bg-gray-600"
                } text-white rounded-lg transition-colors`}
                onClick={toggleListening}
              >
                <Mic className="w-4 h-4" />
              </Button>
              <Button 
                type="submit"
                disabled={!input.trim()}
                className={`${
                  !input.trim() 
                    ? "bg-gray-700"
                    : "bg-blue-600 hover:bg-blue-500"
                } text-white rounded-lg transition-colors`}
              >
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </Card>
          
          <div className="text-center text-xs opacity-50 pb-2">
            BookSageAI &copy; 2025
          </div>
        </div>
      </div>
    </div>
  );
}