import os
import json
import google.generativeai as genai
from PIL import Image

def translate_and_rewrite_copy(reference_image: Image.Image, square_image: Image.Image, ocr_texts: list) -> dict:
    """
    Uses Gemini Multimodal LLM to contextually translate and rewrite Korean OCR texts into English marketing copy.
    Returns a dictionary mapping original text to translated text.
    {"Original Korean Text": "Rewritten English Copy"}
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set in environment.")
        
    genai.configure(api_key=api_key)
    
    # Use gemini-1.5-pro for best multi-modal contextual reasoning
    # gemini-1.5-flash is faster, but pro is better for nuanced copywriting
    model = genai.GenerativeModel('gemini-1.5-pro')
    
    original_text_list = [item["text"] for item in ocr_texts]
    if not original_text_list:
        return {}

    prompt = f"""
    You are an expert global e-commerce marketer and elite copywriter.
    I am providing you with two images:
    1. A reference detail page image (for overall product context).
    2. A specific square working image (where the text actually appears).

    I have extracted the following Korean text blocks from the square working image:
    {json.dumps(original_text_list, ensure_ascii=False, indent=2)}

    Your task:
    1. Understand the product and context from the images.
    2. Translate the extracted Korean texts into highly engaging, modern, and trendy English marketing copy suitable for a global audience.
    3. The copy should be concise enough to fit back into the image.
    4. Return ONLY a valid JSON object where the keys are the EXACT original Korean texts provided above, and the values are your English rewrites. Do not include markdown code block syntax (like ```json), just the raw JSON object.
    """
    
    # We must provide the images in the requested format
    response = model.generate_content([prompt, reference_image, square_image])
    
    # Parse the JSON response
    result_text = response.text.strip()
    # Handle potential markdown formatting from Gemini
    if result_text.startswith("```json"):
        result_text = result_text[7:-3].strip()
    elif result_text.startswith("```"):
        result_text = result_text[3:-3].strip()
        
    try:
        translation_map = json.loads(result_text)
        return translation_map
    except json.JSONDecodeError:
        print("Failed to decode JSON from Gemini response:")
        print(response.text)
        # Fallback empty map if it fails
        return {text: text for text in original_text_list}
