import json
import os
import uvicorn
import base64
from google import genai
from google.genai import types
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

# ==========================================
# CONFIGURATION
# ==========================================

#Load environment variables from .env file
load_dotenv()

#Get key from env
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# API safety check
if not GOOGLE_API_KEY:
    print("❌ CRITICAL ERROR: API Key is missing.")
    print("   Please create a .env file with GOOGLE_API_KEY=AIza...")
    sys.exit(1)

# Clean key just in case
GOOGLE_API_KEY = GOOGLE_API_KEY.strip()

# Initialize the Client
try:
    client = genai.Client(api_key=GOOGLE_API_KEY)
except Exception as e:
    print(f"❌ Error initializing Google Client: {e}")
    sys.exit(1)

# Use Gemini 2.5 flash; best free tier with more RPM
MODEL_NAME = "gemini-2.5-flash"
PORT = 8000

# Initialize FastAPI App
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# SYSTEM PROMPT
# ==========================================
SYSTEM_PROMPT = """
You are a specialized Nutrition Analyzer API.
Your job is to analyze food descriptions (and images if provided) and return a JSON ARRAY of nutrition objects.

RULES:
1. QUANTITIES: If user says "2 burgers", output TWO separate objects.
2. ACCURACY: Estimate calories and macros as accurately as possible for standard serving sizes.
3. OUTPUT: Return ONLY the raw JSON array.

JSON Structure per item:
{
  "food_name": "string",
  "calories": int,
  "protein": int,
  "carbs": int,
  "fats": int,
  "sugar: int,
  "food_type": "string (Category: Fruit, Vegetable, Fast Food, Drink, etc)",
  "reasoning_summary": "Short 1-sentence explanation"
}
"""

#request base model (with image)
class FoodRequest(BaseModel):
    text: str = ""
    image: Optional[str] = None # Base64 string

# ==========================================
# DEBUG TOOL
# ==========================================
def print_available_models():
    """Prints list of models available to this API key on startup"""
    try:
        print("--- Checking Available Gemini Models ---")
        found_model = False
        for m in client.models.list():
            if "generateContent" in m.supported_actions:
                if m.name == f"models/{MODEL_NAME}" or m.name == MODEL_NAME:
                    found_model = True
        print("----------------------------------------")
        
        if found_model:
            print(f"✅ Successfully found model: {MODEL_NAME}")
        else:
            print(f"⚠️ WARNING: '{MODEL_NAME}' not found in your list.")
            
    except Exception as e:
        print(f"⚠️ Could not list models (Check API Key): {e}")

@app.on_event("startup")
def startup_event():
    print_available_models()

@app.post("/analyze")
def analyze_food(request: FoodRequest):
    print(f"Received Text: {request.text}")
    if request.image:
        print("Received Image Data")

    try:
        # Prepare content list for Gemini
        contents = []
        
        # Add System Prompt & Text
        prompt_text = f"{SYSTEM_PROMPT}\n\nUSER INPUT: {request.text}"
        contents.append(prompt_text)

        # Process Image if present
        if request.image:
            try:
                # Remove header "data:image/jpeg;base64," if present
                if "base64," in request.image:
                    image_data = request.image.split("base64,")[1]
                else:
                    image_data = request.image
                
                # Decode
                image_bytes = base64.b64decode(image_data)
                
                # Create Image Part
                image_part = types.Part.from_bytes(
                    data=image_bytes, 
                    mime_type="image/jpeg" 
                )
                contents.append(image_part)
                
            except Exception as img_err:
                print(f"Image processing error: {img_err}")

        # Call Gemini
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1
            )
        )
        
        print(f"Gemini Response: {response.text}") 
        final_data = json.loads(response.text)
        
        # Standardize Output to List
        if isinstance(final_data, dict):
            if "items" in final_data:
                final_data = final_data["items"]
            else:
                final_data = [final_data]

        return final_data

    except Exception as e:
        print(f"Gemini Error: {e}")
        error_msg = str(e)
        if "429" in error_msg:
            raise HTTPException(status_code=429, detail="Daily Free Limit Exceeded. Try again tomorrow.")
        raise HTTPException(status_code=500, detail=f"AI Error: {error_msg}")

if __name__ == '__main__':
    print(f"✅ Gemini Server running on http://localhost:{PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)