import PyPDF2
import re
import spacy
import io
from flask import Flask, request, jsonify
from flask_cors import CORS
from langchain.text_splitter import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer
from supabase import create_client, Client
from google.generativeai import GenerativeModel
import google.generativeai as genai


nlp = spacy.load("en_core_web_sm")
embedding_model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

SUPABASE_URL = "https://mngoftqnimynaxmmfnng.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uZ29mdHFuaW15bmF4bW1mbm5nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA4MDYzMjMsImV4cCI6MjA1NjM4MjMyM30.ZSZHtdH_RcO6CMM3P-DKxv9O55-nfKdvHiGwP4LA_y8"
GEMINI_API_KEY="AIzaSyDxRalitk2KQhHINRPROVqs94x10Hm6J74"
genai.configure(api_key=GEMINI_API_KEY)
model = GenerativeModel('gemini-2.0-flash')

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app = Flask(__name__)
CORS(app)

def clean_text(text):
    text = re.sub(r'\s+', ' ', text)  
    text = re.sub(r'[^\w\s.,!?]', '', text)  
    return text.strip()

def split_into_sentences(text):
    doc = nlp(text)
    return [sent.text.strip() for sent in doc.sents]

def chunk_text(sentences, chunk_size=300, chunk_overlap=100):
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,  
        chunk_overlap=chunk_overlap,  
        separators=["\n\n", "\n", " "],  
    )
    return text_splitter.create_documents(sentences)

def extract_text(file_stream):
    try:
        reader = PyPDF2.PdfReader(file_stream)
        full_text = " ".join([page.extract_text() or "" for page in reader.pages])
        cleaned_text = clean_text(full_text)

        sentences = split_into_sentences(cleaned_text)
        chunked_docs = chunk_text(sentences)

        return [doc.page_content for doc in chunked_docs]

    except Exception as e:
        return {"error": str(e)}

def store_embeddings_in_supabase(document_name, chunks):
    try:
        embeddings = embedding_model.encode(chunks).tolist()

        data_to_insert = [
            {"title": document_name, "content": chunk, "embedding": embedding}
            for chunk, embedding in zip(chunks, embeddings)
        ]

        response = supabase.table("documents").insert(data_to_insert).execute()
        return response.data

    except Exception as e:
        return {"error": str(e)}

@app.route("/upload", methods=["POST"])
def upload_file():
    if "file" not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    file_stream = io.BytesIO(file.read())

    extracted_text = extract_text(file_stream)

    if isinstance(extracted_text, dict) and "error" in extracted_text:
        return jsonify(extracted_text), 500

    supabase_response = store_embeddings_in_supabase(file.filename, extracted_text)

    return jsonify({
        "message": "File processed successfully",
        "supabase_response": supabase_response
    })

@app.route("/embed", methods=["POST"])
def generate_embedding():
    data = request.get_json()
    if not data or "text" not in data:
        return jsonify({"error": "No text provided"}), 400

    try:
        text = data["text"]
        embedding = embedding_model.encode([text])[0].tolist()
        return jsonify({"embedding": embedding})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/generate-answer', methods=['POST'])
def generate_answer():
    data = request.json
    query = data.get('query')
    context = data.get('context')
    document_name = data.get('documentName')
    
    if not query or not context:
        return jsonify({"error": "Query and context are required"}), 400
    
    try:
        prompt = f"""
        You are BookSageAI, an assistant that helps users understand documents.
        
        USER QUERY: {query}
        
        DOCUMENT: {document_name if document_name else 'Uploaded document'}
        
        RELEVANT CONTEXT FROM THE DOCUMENT:
        {context}
        
        Based ONLY on the information provided in the context above, please answer the user's query.
        If the context doesn't contain information to answer the query, acknowledge that and suggest what might be relevant to look for.
        Format your response in a conversational and helpful way. Do not mention that you're using context or that you're an AI.
        """
        
        # Generate response using Gemini
        response = model.generate_content(prompt)
        
        # Process Gemini's response
        answer = response.text
        
        return jsonify({"answer": answer})
    
    except Exception as e:
        print(f"Error generating answer: {str(e)}")
        return jsonify({"error": str(e)}), 500




if __name__ == "__main__":
    app.run(debug=True, port=5000)








