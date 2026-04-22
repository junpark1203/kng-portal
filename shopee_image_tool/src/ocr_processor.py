import io
import os
from google.cloud import vision

def extract_text_with_vision(image_bytes: bytes):
    """
    Extracts text and its bounding boxes from an image using Google Cloud Vision.
    Returns a list of dictionaries: [{"text": str, "bbox": [(x,y), ...]}, ...]
    """
    # Check if credentials are set, this is a safety check.
    if "GOOGLE_APPLICATION_CREDENTIALS" not in os.environ:
        raise ValueError("Google Cloud Vision API key is not set in environment.")

    client = vision.ImageAnnotatorClient()
    image = vision.Image(content=image_bytes)

    response = client.document_text_detection(image=image)
    if response.error.message:
        raise Exception(f"Vision API Error: {response.error.message}")

    extracted_blocks = []
    
    # We iterate over blocks instead of just words to preserve paragraph context
    # where possible, though document_text_detection groups by pages->blocks->paras
    for page in response.full_text_annotation.pages:
        for block in page.blocks:
            block_text = ""
            for paragraph in block.paragraphs:
                for word in paragraph.words:
                    word_text = "".join([symbol.text for symbol in word.symbols])
                    block_text += word_text + " "
            
            block_text = block_text.strip()
            if not block_text:
                continue
                
            # Get bounding box vertices
            vertices = [(vertex.x, vertex.y) for vertex in block.bounding_box.vertices]
            
            extracted_blocks.append({
                "text": block_text,
                "bbox": vertices
            })
            
    return extracted_blocks
