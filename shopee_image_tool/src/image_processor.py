import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import os

def check_font_exists(font_path: str):
    if not os.path.exists(font_path):
        # Fallback to default PIL font if not found, but it won't look great
        return ImageFont.load_default()
    return None

def inpaint_image(image: Image.Image, ocr_texts: list) -> Image.Image:
    """
    Removes text from image using OpenCV inpainting based on OCR bounding boxes.
    """
    # Convert PIL to OpenCV format (RGB to BGR)
    img_cv = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    
    # Create an empty mask
    mask = np.zeros(img_cv.shape[:2], dtype=np.uint8)
    
    # Draw solid white polygons on the mask where text was found
    for item in ocr_texts:
        bbox = item["bbox"]
        pts = np.array(bbox, np.int32)
        pts = pts.reshape((-1, 1, 2))
        cv2.fillPoly(mask, [pts], 255)
        
    # Dilate mask slightly to ensure text edges are covered
    kernel = np.ones((5,5), np.uint8)
    mask = cv2.dilate(mask, kernel, iterations=1)
    
    # Perform Inpainting (TELEA is generally faster, Navier-Stokes can be smoother)
    # Using INPAINT_NS (Navier-Stokes)
    inpainted_img = cv2.inpaint(img_cv, mask, 3, cv2.INPAINT_NS)
    
    # Convert back to PIL Image (BGR to RGB)
    result_image = Image.fromarray(cv2.cvtColor(inpainted_img, cv2.COLOR_BGR2RGB))
    return result_image

def composite_translated_texts(image: Image.Image, ocr_texts: list, translation_map: dict, font_path="assets/Montserrat-Bold.ttf") -> Image.Image:
    """
    Draws the translated English texts onto the image within the original bounding boxes.
    """
    draw = ImageDraw.Draw(image)
    
    # Initial fallback check
    base_font = check_font_exists(font_path)

    for item in ocr_texts:
        orig_text = item["text"]
        new_text = translation_map.get(orig_text, orig_text) # fallback to original if not found
        
        bbox = item["bbox"]
        # Find bounding box dimensions
        xs = [pt[0] for pt in bbox]
        ys = [pt[1] for pt in bbox]
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)
        
        box_width = x_max - x_min
        box_height = y_max - y_min
        
        # Determine the best font size to fit the box
        # Starts big and shrinks down
        best_font_size = 100
        font = base_font
        
        if base_font is None:
            # We have the physical TTF file, let's find the right size
            for size in range(100, 8, -2):
                temp_font = ImageFont.truetype(font_path, size)
                left, top, right, bottom = draw.textbbox((0, 0), new_text, font=temp_font)
                text_w = right - left
                text_h = bottom - top
                if text_w <= box_width * 0.95 and text_h <= box_height * 0.95:
                    best_font_size = size
                    font = temp_font
                    break
            
            # If it still doesn't fit, just use the smallest we tried
            if font is None or best_font_size == 100:
                font = ImageFont.truetype(font_path, 10)
        
        # Calculate centering within the bounding box
        left, top, right, bottom = draw.textbbox((0, 0), new_text, font=font)
        text_w = right - left
        text_h = bottom - top
        
        x_pos = x_min + (box_width - text_w) / 2
        y_pos = y_min + (box_height - text_h) / 2
        
        # For this tool, default to drawing Dark Grey/Black text
        # In a real app, you might sample the surrounding color or text color from OCR
        text_color = (30, 30, 30) # Dark grey
        
        draw.text((x_pos, y_pos), new_text, font=font, fill=text_color)
        
    return image
