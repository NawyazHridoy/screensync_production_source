# 3D Animated Brain Degradation GIF Generator

This package contains the complete Python source code and the 4 high-resolution 3D brain expression keyframes (`assets/`, with teeth removed) used to generate `cute_3d_brain_big_eyes_slow_smooth.gif`.

## Features Implemented
- **Zero Teeth**: The single front tooth has been cleanly removed from all source assets and via automatic inpainting in `generate_brain_gif.py`.
- **Progressive Brain Degradation (Healthy -> Gray Color)**:
  - Starts completely healthy with a vibrant pink/coral 3D brain, bright sparkling eyes, and a big happy smile.
  - Progressively degrades over time through a desaturated decay stage until the entire brain turns completely gray while preserving its 3D folds and texture.
- **Dynamic Facial Expression Transition (Smile -> No Smile / Lifeless Frown)**:
  - As the brain degrades, the happy smile progressively fades and closes into a sad, lifeless frown with zero smile remaining when completely decayed.
  - The eyebrows tilt into a sad expression, the upper eyelids droop heavily, and the bright eye catchlights & ambient sparkles fade away.

## Folder Structure
- `generate_brain_gif.py` — Main Python animation script.
- `requirements.txt` — Python dependencies (`Pillow`, `numpy`).
- `assets/`
  - `brain_open_eyes.jpg` — Big glossy open eyes + toothless smile
  - `brain_half_blink.jpg` — Half-closed eyelids blink/droop transition (toothless)
  - `brain_closed_blink.jpg` — Fully closed blink (toothless)
  - `brain_wink.jpg` — Wink expression (toothless)

## How to Run
1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Run the generator script:
   ```bash
   python generate_brain_gif.py
   ```
3. Customize speed or frame count inside `generate_brain_gif.py`:
   - `NUM_FRAMES = 72` (total frames in the progression loop)
   - `FRAME_DURATION_MS = 75` (milliseconds per frame)
