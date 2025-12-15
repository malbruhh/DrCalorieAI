import json
import os
import uvicorn
from google import genai
from google.genai import types
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any

# ==========================================
# CONFIGURATION
# ==========================================
# 1. PASTE YOUR GOOGLE API KEY HERE
GOOGLE_API_KEY = "AIzaSyCollA6aPsr3Lj-WkTThwLHZc-ArgEPq8s"

# Initialize the new Client
# The new SDK uses a client instance rather than global configuration
client = genai.Client(api_key=GOOGLE_API_KEY)

# Using 'gemini-1.5-flash' (standard alias)
MODEL_NAME = "gemini-2.0-flash-lite-preview-02-05"
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
Your job is to analyze food descriptions and return a JSON ARRAY of nutrition objects.

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
  "food_type": "string (Category: Fruit, Vegetable, Fast Food, Drink, etc)",
  "reasoning_summary": "Short 1-sentence explanation"
}
"""

class FoodRequest(BaseModel):
    text: str

# ==========================================
# DEBUG TOOL: Check Available Models
# ==========================================
def print_available_models():
    """Prints list of models available to this API key on startup using new SDK"""
    try:
        print("--- Checking Available Gemini Models ---")
        found_flash = False
        # New SDK method to list models
        for m in client.models.list():
            # Filter for generation capable models
            if "generateContent" in m.supported_actions:
                print(f"✅ Found: {m.name}")
                if "flash" in m.name:
                    found_flash = True
        print("----------------------------------------")
        
        if not found_flash:
            print("⚠️ WARNING: 'gemini-1.5-flash' not found in your list.")
    except Exception as e:
        print(f"⚠️ Could not list models (Check API Key): {e}")

@app.on_event("startup")
def startup_event():
    print_available_models()

@app.post("/analyze")
def analyze_food(request: FoodRequest):
    print(f"Received: {request.text}")

    try:
        # Call Gemini with the new SDK structure
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=f"{SYSTEM_PROMPT}\n\nUSER INPUT: {request.text}",
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
        if "404" in error_msg:
            raise HTTPException(status_code=500, detail="Model not found. Check server console for available models.")
        raise HTTPException(status_code=500, detail=f"AI Error: {error_msg}")

if __name__ == '__main__':
    print(f"✅ Gemini Server running on http://localhost:{PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)