import json
import random
import sys
from PIL import Image

def generate_hologram_data(image_path, output_path, var_name):
    try:
        img = Image.open(image_path).convert("RGB")
    except Exception as e:
        print(f"Error opening image: {e}")
        return

    # Target points is ~6000. Resize image to manage density
    # 120x120 is 14400 total pixels, usually about 30-50% are non-black
    img.thumbnail((120, 120))
    width, height = img.size
    
    positions = []
    colors = []
    
    for y in range(height):
        for x in range(width):
            r, g, b = img.getpixel((x, y))
            brightness = (r + g + b) / 3.0
            
            # Skip dark background pixels
            if brightness < 15:
                continue
                
            # Map image (x, y) coordinates to 3D Three.js space (-ish)
            # Center the image
            px = (x - width / 2.0) * 1.5
            # Invert Y because image 0,0 is top-left, but 3D 0,0 is center bottom-up
            py = -(y - height / 2.0) * 1.5 
            
            # Depth based on brightness. Brighter parts bulge out slightly
            pz = (brightness / 255.0) * 15.0 
            # Add spatial noise for the particle/energy feel
            pz += random.uniform(-2, 2)
            px += random.uniform(-0.5, 0.5)
            py += random.uniform(-0.5, 0.5)
            
            positions.append(round(px, 3))
            positions.append(round(py, 3))
            positions.append(round(pz, 3))
            
            # Normalize colors (0 to 1 for Three.js)
            colors.append(round(r / 255.0, 3))
            colors.append(round(g / 255.0, 3))
            colors.append(round(b / 255.0, 3))
            
    # Need to match the fixed 6000 point count buffer in script.js exactly 
    # to avoid morphing index out of bounds errors.
    TARGET_POINTS = 6000
    current_points = len(positions) // 3
    
    print(f"Generated {current_points} valid points from image.")
    
    if current_points > TARGET_POINTS:
        # We need to trim randomly
        points = list(zip(
            [positions[i:i+3] for i in range(0, len(positions), 3)],
            [colors[i:i+3] for i in range(0, len(colors), 3)]
        ))
        random.shuffle(points)
        points = points[:TARGET_POINTS]
        positions = [v for p in points for v in p[0]]
        colors = [v for p in points for v in p[1]]
    else:
        # We need to duplicate randomly to reach 6000
        points = list(zip(
            [positions[i:i+3] for i in range(0, len(positions), 3)],
            [colors[i:i+3] for i in range(0, len(colors), 3)]
        ))
        while len(points) < TARGET_POINTS:
            clone = random.choice(points)
            # Add a bit of jitter to the clone so it's not perfectly stacked
            new_pos = [clone[0][0] + random.uniform(-1,1), clone[0][1] + random.uniform(-1,1), clone[0][2] + random.uniform(-1,1)]
            points.append((new_pos, clone[1]))
            
        positions = [v for p in points for v in p[0]]
        colors = [v for p in points for v in p[1]]
        
    print(f"Final standardized points: {len(positions)//3}")

    with open(output_path, 'w') as f:
        data_str = json.dumps({
            "positions": positions,
            "colors": colors
        })
        f.write(f"window.{var_name} = {data_str};")
        
    print(f"Saved to {output_path}")

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python generate_particles.py <input_img> <output_js> <var_name>")
        sys.exit(1)
    generate_hologram_data(sys.argv[1], sys.argv[2], sys.argv[3])
