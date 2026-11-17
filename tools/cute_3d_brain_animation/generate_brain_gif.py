#!/usr/bin/env python3
"""
Cute 3D Cartoon Brain Mascot - High-Fidelity Procedural Renderer
=================================================================
Generates a 1080x1080 seamless looping animated GIF (and MP4 preview) of a cute,
plump, glossy 3D stylized cartoon brain mascot performing a joyful floating and
bouncing idle animation.

Visual & Structural Upgrades:
- Truly rounded, plump, marshmallow-like 3D silhouette (tall and full in the center,
  softly tapering at the front and back, never flat or pancake-like).
- Multi-frequency organic cortical folds (gyri and sulci) with domain warping so
  folds look like soft, puffy brain lobes rather than uniform stripes.
- Deep ambient occlusion and warm subsurface scattering inside every sulcus crease.
- Dual-studio Pixar/Blender-style lighting with glossy dual-lobe specular highlights,
  soft Fresnel rim glow, and warm bounce light from below.
- Cute kawaii facial expression on the frontal lobe: big glossy dark eyes with dual
  catchlights, rosy airbrushed cheeks, and a cheerful little smile.
- Smooth 60-frame seamless cycle (30 FPS, 2.0 seconds) with squash-and-stretch,
  gentle 3D yaw/pitch/roll oscillation, subtle breathing pulse, and an Natural
  blinking animation.
"""

import os
import time
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
WIDTH = 1080
HEIGHT = 1080
RENDER_SCALE = 1  # Native 1080x1080 with analytical anti-aliasing
NUM_FRAMES = 60   # 2.0 seconds @ 30 fps
# Runtime 11-Stage Brain Degradation Scale (50-reel steps: 0=0 reels, 1=50, 2=100, 3=150, 4=200, 5=250, 6=300, 7=350, 8=400, 9=450, 10=500+ reels)
FPS = 30
FRAME_DURATION_MS = int(round(1000 / FPS))

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
GIF_PATH = os.path.join(OUTPUT_DIR, "cute_3d_brain_animation.gif")
PREVIEW_SHEET_PATH = os.path.join(OUTPUT_DIR, "cute_3d_brain_keyframes.png")
POSTER_FRAME_PATH = os.path.join(OUTPUT_DIR, "cute_3d_brain_poster_1080p.png")


# ---------------------------------------------------------------------------
# Math & Noise Utilities (Vectorized NumPy)
# ---------------------------------------------------------------------------
def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0 + 1e-8), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def smin(a, b, k=0.12):
    """Smooth minimum for blending 3D SDF shapes organically."""
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k=0.08):
    """Smooth maximum for carving soft creases."""
    return -smin(-a, -b, k)


def gyroid(p, freq=1.0, phase=(0.0, 0.0, 0.0)):
    """3D Gyroid field: sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x).
    Produces continuous, meandering labyrinthine ridges like brain gyri."""
    px = p[..., 0] * freq + phase[0]
    py = p[..., 1] * freq + phase[1]
    pz = p[..., 2] * freq + phase[2]
    return (
        np.sin(px) * np.cos(py)
        + np.sin(py) * np.cos(pz)
        + np.sin(pz) * np.cos(px)
    )


def brain_sulci_field(p):
    """
    Computes a rich, non-repetitive cortical fold pattern over 3D surface coordinates.
    Returns:
      height_field in [0, 1] where 1 = puffy gyrus crown, 0 = deep sulcus valley
      sulcus_mask  in [0, 1] where 1 = deep sulcus groove
    """
    # Mirror X slightly with soft asymmetry so hemispheres look natural & hand-sculpted
    px = np.abs(p[..., 0])
    sign_x = np.tanh(p[..., 0] * 4.0)
    py = p[..., 1]
    pz = p[..., 2]

    q = np.stack([px, py, pz], axis=-1)

    # Low-frequency domain warp for natural meandering lobes
    warp_x = 0.22 * gyroid(q, freq=3.2, phase=(0.5, 1.1, 2.3))
    warp_y = 0.22 * gyroid(q, freq=3.2, phase=(2.1, 0.4, 1.7))
    warp_z = 0.22 * gyroid(q, freq=3.2, phase=(1.3, 2.8, 0.9))
    qw = q + np.stack([warp_x, warp_y, warp_z], axis=-1) + 0.06 * sign_x[..., None]

    # Primary cortical folds (medium wavelength)
    g1 = gyroid(qw, freq=6.4, phase=(0.3, 1.4, 0.8))
    # Secondary branching folds (rotated & shifted phase)
    qw_rot = np.stack([
        0.8 * qw[..., 0] - 0.6 * qw[..., 2],
        0.6 * qw[..., 0] + 0.8 * qw[..., 2],
        qw[..., 1]
    ], axis=-1)
    g2 = gyroid(qw_rot, freq=9.2, phase=(1.9, 0.7, 2.4))

    # Combine primary and secondary gyroid fields into rounded ridge crowns
    # Using abs(g) gives crisp valleys (at g=0) and plump crowns (at |g|>0)
    ridge1 = 1.0 - np.exp(-3.2 * (g1 * g1))
    ridge2 = 1.0 - np.exp(-2.5 * (g2 * g2))

    # Blend primary and secondary ridges
    combined = 0.68 * ridge1 + 0.32 * ridge2

    # Carve a distinct lateral fissure (Sylvian fissure) on the side of each hemisphere
    # Runs diagonally along the side (high |x|, mid-low y, mid-front z)
    sylvian_dist = np.sqrt(
        ((px - 0.62) / 0.28) ** 2
        + ((py + 0.06 - 0.22 * pz) / 0.11) ** 2
        + ((pz - 0.10) / 0.48) ** 2
    )
    sylvian_groove = np.exp(-2.8 * (sylvian_dist ** 2)) * smoothstep(0.35, 0.60, px)

    # Carve a gentle parieto-occipital / central sulcus accent near the top
    central_dist = np.sqrt(
        ((px - 0.38) / 0.42) ** 2
        + ((pz + 0.05 - 0.18 * py) / 0.09) ** 2
        + ((py - 0.35) / 0.40) ** 2
    )
    central_groove = np.exp(-3.0 * (central_dist ** 2)) * smoothstep(0.10, 0.50, py)

    height = combined * (1.0 - 0.55 * sylvian_groove) * (1.0 - 0.45 * central_groove)

    # Remap height with a puffy dome curve so gyri look pillowy and plush
    puffy_height = np.sqrt(np.clip(height, 0.0, 1.0))

    # Sulcus crease factor (sharp dark lines inside the valleys)
    sulcus = np.clip(1.0 - smoothstep(0.08, 0.52, puffy_height), 0.0, 1.0)
    return puffy_height, sulcus


# ---------------------------------------------------------------------------
# 3D Brain Base Geometry (Signed Distance Field)
# ---------------------------------------------------------------------------
def brain_base_sdf(p):
    """
    Evaluates the smooth macro 3D Signed Distance Field of a plump, cute stylized brain.
    Coordinate system (object space):
      +X : right hemisphere, -X : left hemisphere
      +Y : top (dorsal),     -Y : bottom (ventral)
      +Z : front (anterior, towards viewer), -Z : back (posterior)
    """
    x = p[..., 0]
    y = p[..., 1]
    z = p[..., 2]
    ax = np.abs(x)

    # Subtle tapering: slightly narrower at the very front (+Z), fuller in mid-back,
    # and softly arched on the bottom so it looks like a real cute brain silhouette.
    taper_x = 1.0 - 0.08 * smoothstep(-0.2, 0.8, z)
    arch_y = -0.05 * np.cos(np.clip(z * 1.8, -np.pi, np.pi))

    # Left & Right Cerebral Hemispheres: two plump, overlapping ellipsoids
    # Offset outward by +/- 0.27 so they form a natural heart/bean-like twin dome
    hemi_cx = 0.27 * taper_x
    hemi_cy = 0.05 + arch_y
    hemi_cz = 0.0

    # Radii of each hemisphere lobe (plump vertically and deep front-to-back)
    rx, ry, rz = 0.56, 0.64, 0.72
    dx = (ax - hemi_cx) / rx
    dy = (y - hemi_cy) / ry
    dz = (z - hemi_cz) / rz
    d_hemi = (np.sqrt(dx * dx + dy * dy + dz * dz + 1e-8) - 1.0) * min(rx, ry, rz)

    # Temporal Lobe Bulges (lower sides, giving that classic cute side-profile of a brain)
    temp_cx = 0.46
    temp_cy = -0.20
    temp_cz = 0.08
    trx, try_, trz = 0.34, 0.27, 0.46
    tdx = (ax - temp_cx) / trx
    tdy = (y - temp_cy) / try_
    tdz = (z - temp_cz) / trz
    d_temp = (np.sqrt(tdx * tdx + tdy * tdy + tdz * tdz + 1e-8) - 1.0) * min(trx, try_, trz)

    # Combine main hemisphere dome and temporal lobe smoothly
    d_body = smin(d_hemi, d_temp, k=0.18)

    # Cute rounded cerebellum tucked at the lower back
    cere_cx = 0.20
    cere_cy = -0.32
    cere_cz = -0.38
    crx, cry, crz = 0.30, 0.22, 0.28
    cdx = (ax - cere_cx) / crx
    cdy = (y - cere_cy) / cry
    cdz = (z - cere_cz) / crz
    d_cere = (np.sqrt(cdx * cdx + cdy * cdy + cdz * cdz + 1e-8) - 1.0) * min(crx, cry, crz)

    d_macro = smin(d_body, d_cere, k=0.14)

    # Softly flatten the very bottom base so the mascot sits/floats with a cohesive underside
    bottom_plane = -(y + 0.54 - 0.05 * (x * x + z * z))
    d_macro = smax(d_macro, bottom_plane, k=0.12)

    # Longitudinal Medial Fissure (the central groove dividing left & right hemispheres)
    # Deeper along the top and front/back crown, shallower near the core
    fissure_profile = smoothstep(-0.25, 0.35, y) + 0.45 * smoothstep(0.25, 0.70, np.abs(z))
    fissure_profile = np.clip(fissure_profile, 0.0, 1.15)
    fissure_indent = 0.095 * fissure_profile * np.exp(-38.0 * (x * x))

    return d_macro + fissure_indent


def brain_full_sdf(p):
    """
    Full displaced SDF including the puffy cortical gyri and sulci grooves.
    Also blends a smooth facial patch on the lower-front so the cute eyes and
    smile sit cleanly on plump lobes without getting distorted by deep creases.
    """
    d_base = brain_base_sdf(p)

    # Evaluate cortical folds only near the surface shell for speed
    puffy_h, _ = brain_sulci_field(p)

    # Reduce sulcus depth slightly right around the cute eyes/mouth area on the front
    # so the kawaii face reads super clearly while still looking 100% like a brain
    fx = p[..., 0]
    fy = p[..., 1]
    fz = p[..., 2]
    face_zone = (
        smoothstep(0.35, 0.65, fz)
        * (1.0 - smoothstep(0.18, 0.48, np.abs(fx)))
        * (1.0 - smoothstep(0.16, 0.38, np.abs(fy + 0.04)))
    )

    fold_amplitude = 0.046 * (1.0 - 0.55 * face_zone)
    displacement = (puffy_h - 0.55) * fold_amplitude

    return d_base - displacement


# ---------------------------------------------------------------------------
# Raymarching & Surface Normal Calculation
# ---------------------------------------------------------------------------
def compute_normals(p):
    """Central-difference gradient of the full displaced SDF for crisp 3D bump normals."""
    eps = 0.0035
    dx = np.array([eps, 0.0, 0.0], dtype=np.float32)
    dy = np.array([0.0, eps, 0.0], dtype=np.float32)
    dz = np.array([0.0, 0.0, eps], dtype=np.float32)

    nx = brain_full_sdf(p + dx) - brain_full_sdf(p - dx)
    ny = brain_full_sdf(p + dy) - brain_full_sdf(p - dy)
    nz = brain_full_sdf(p + dz) - brain_full_sdf(p - dz)

    n = np.stack([nx, ny, nz], axis=-1)
    norm = np.linalg.norm(n, axis=-1, keepdims=True) + 1e-8
    return n / norm


def compute_macro_normals(p):
    """Smooth macro normals for broad subsurface scattering & rim lighting."""
    eps = 0.015
    dx = np.array([eps, 0.0, 0.0], dtype=np.float32)
    dy = np.array([0.0, eps, 0.0], dtype=np.float32)
    dz = np.array([0.0, 0.0, eps], dtype=np.float32)

    nx = brain_base_sdf(p + dx) - brain_base_sdf(p - dx)
    ny = brain_base_sdf(p + dy) - brain_base_sdf(p - dy)
    nz = brain_base_sdf(p + dz) - brain_base_sdf(p - dz)

    n = np.stack([nx, ny, nz], axis=-1)
    norm = np.linalg.norm(n, axis=-1, keepdims=True) + 1e-8
    return n / norm


# ---------------------------------------------------------------------------
# Background Precomputation (Warm Studio Pastel Backdrop)
# ---------------------------------------------------------------------------
def build_studio_background(width, height):
    y_norm, x_norm = np.mgrid[0:height, 0:width].astype(np.float32)
    x_c = (x_norm / width - 0.5) * 2.0
    y_c = (y_norm / height - 0.5) * 2.0

    # Soft radial studio spotlight gradient (creamy peach-blush center to soft lavender-rose edge)
    r = np.sqrt(x_c * x_c + (y_c + 0.08) ** 2)
    t = np.clip(r / 1.35, 0.0, 1.0)
    t_smooth = t * t * (3.0 - 2.0 * t)

    # Center color: warm creamy blush (#FFF5F7) -> Edge color: soft dusty rose/lavender (#F2DCE4)
    c_center = np.array([255.0, 246.0, 248.0], dtype=np.float32)
    c_edge = np.array([238.0, 214.0, 226.0], dtype=np.float32)

    # Add a subtle studio floor horizon gradient near the bottom
    floor_mask = smoothstep(0.20, 0.85, y_c)
    c_floor = np.array([245.0, 225.0, 234.0], dtype=np.float32)

    bg = c_center * (1.0 - t_smooth[..., None]) + c_edge * t_smooth[..., None]
    bg = bg * (1.0 - 0.35 * floor_mask[..., None]) + c_floor * (0.35 * floor_mask[..., None])
    return bg


# ---------------------------------------------------------------------------
# Frame Renderer
# ---------------------------------------------------------------------------
def render_frame(frame_idx, num_frames, bg_rgb, screen_grid):
    """
    Renders a single 1080x1080 frame at phase t in [0, 1).
    """
    t = frame_idx / float(num_frames)
    tau = 2.0 * np.pi * t

    # -----------------------------------------------------------------------
    # 1. Expressive Toy-Like Animation Kinematics (Seamless Loop)
    # -----------------------------------------------------------------------
    # Two-beat joyful floating bounce per 2-second loop (1 beat per second)
    bounce_wave = np.sin(tau)
    bounce_2x = np.sin(2.0 * tau - 0.35)

    # Vertical hover displacement (+Y is up in world space)
    pos_y = 0.065 * bounce_wave + 0.015 * np.cos(2.0 * tau)
    pos_x = 0.022 * np.sin(tau + 0.4)

    # Squash and stretch coupled to vertical acceleration
    # When at the bottom of the dip, gently squash (wider X/Z, shorter Y)
    # When rising/cresting, gently stretch
    stretch = 0.042 * np.sin(tau + 0.25) + 0.014 * bounce_2x
    scale_y = 1.0 + stretch
    scale_xz = 1.0 / np.sqrt(scale_y)

    # Gentle 3D rotation: playful head-tilt (roll), curious nod (pitch), and yaw turn
    yaw = np.deg2rad(11.0 * np.sin(tau) + 3.0 * np.sin(2.0 * tau))
    pitch = np.deg2rad(-7.0 + 5.5 * np.cos(tau - 0.3))
    roll = np.deg2rad(4.5 * np.sin(tau + 0.8))

    # Rotation matrices (Object <-> World)
    cy, sy = np.cos(yaw), np.sin(yaw)
    cp, sp = np.cos(pitch), np.sin(pitch)
    cr, sr = np.cos(roll), np.sin(roll)

    # R = R_yaw * R_pitch * R_roll
    R_yaw = np.array([[cy, 0.0, sy], [0.0, 1.0, 0.0], [-sy, 0.0, cy]], dtype=np.float32)
    R_pitch = np.array([[1.0, 0.0, 0.0], [0.0, cp, -sp], [0.0, sp, cp]], dtype=np.float32)
    R_roll = np.array([[cr, -sr, 0.0], [sr, cr, 0.0], [0.0, 0.0, 1.0]], dtype=np.float32)

    R_obj_to_world = R_yaw @ R_pitch @ R_roll
    R_world_to_obj = R_obj_to_world.T

    # Cute natural blink near frame 42 (smooth double-exponential eyelid closure)
    blink_center = 0.70
    blink_dist = (t - blink_center + 0.5) % 1.0 - 0.5
    blink_amount = np.exp(-((blink_dist / 0.038) ** 4))

    # -----------------------------------------------------------------------
    # 2. Camera & Bounding-Sphere Ray Masking
    # -----------------------------------------------------------------------
    # Camera sits at Z = +2.85 looking towards origin (0, 0, 0)
    cam_orig_world = np.array([0.0, 0.02, 2.85], dtype=np.float32)
    ray_dir_world = screen_grid  # Pre-normalized (H, W, 3)

    # Center of the brain in world space
    brain_center_world = np.array([pos_x, pos_y, 0.0], dtype=np.float32)

    # Analytical bounding sphere test in world space (radius = 1.02) so we only
    # raymarch pixels whose rays pass near the 3D brain!
    oc = cam_orig_world - brain_center_world
    b_dot = np.sum(ray_dir_world * oc, axis=-1)
    c_dot = np.sum(oc * oc) - 1.02 ** 2
    disc = b_dot * b_dot - c_dot

    active_mask = disc > 0.0
    active_indices = np.where(active_mask)

    # Start with studio background and dynamic soft ground shadow
    frame_rgb = bg_rgb.copy()

    # -----------------------------------------------------------------------
    # 3. Dynamic Soft Ground Shadow on the Studio Floor
    # -----------------------------------------------------------------------
    # Shadow sits beneath the floating brain; shrinks and softens as brain rises
    ug = screen_grid[..., 0]
    vg = screen_grid[..., 1]
    shadow_cx = pos_x * 0.36
    shadow_cy = -0.315
    height_factor = np.clip((pos_y + 0.08) / 0.16, 0.0, 1.0)
    shadow_rx = 0.24 * (1.0 - 0.12 * height_factor)
    shadow_ry = 0.048 * (1.0 - 0.12 * height_factor)

    s_dist = np.sqrt(((ug - shadow_cx) / shadow_rx) ** 2 + ((vg - shadow_cy) / shadow_ry) ** 2)
    shadow_alpha = (0.24 - 0.08 * height_factor) * np.exp(-2.2 * (s_dist ** 2))
    # Warm plum-tinted studio contact shadow
    shadow_tint = np.array([175.0, 130.0, 152.0], dtype=np.float32)
    frame_rgb = frame_rgb * (1.0 - shadow_alpha[..., None]) + shadow_tint * shadow_alpha[..., None]

    # -----------------------------------------------------------------------
    # 4. Raymarching in Object Space for Active Pixels
    # -----------------------------------------------------------------------
    ro_world = np.broadcast_to(cam_orig_world - brain_center_world, ray_dir_world[active_mask].shape)
    rd_world = ray_dir_world[active_mask]

    # Transform rays into object space (with inverse squash-and-stretch)
    inv_scale = np.array([1.0 / scale_xz, 1.0 / scale_y, 1.0 / scale_xz], dtype=np.float32)
    ro_obj = (ro_world @ R_world_to_obj.T) * inv_scale
    rd_obj_unnorm = (rd_world @ R_world_to_obj.T) * inv_scale
    rd_scale_len = np.linalg.norm(rd_obj_unnorm, axis=-1, keepdims=True) + 1e-8
    rd_obj = rd_obj_unnorm / rd_scale_len

    # Entry distance along ray from bounding sphere
    disc_active = np.sqrt(np.maximum(disc[active_mask], 0.0))
    t_near_world = np.maximum(-b_dot[active_mask] - disc_active, 0.0)
    t_far_world = -b_dot[active_mask] + disc_active

    t_march = t_near_world * rd_scale_len[..., 0]
    t_max = t_far_world * rd_scale_len[..., 0]

    # Track closest approach for analytical edge anti-aliasing
    min_sdf = np.full(t_march.shape, 10.0, dtype=np.float32)
    hit_mask = np.zeros(t_march.shape, dtype=bool)

    # 34 sphere-tracing steps (fast & accurate since we start right at bounding sphere)
    for _ in range(34):
        pts = ro_obj + rd_obj * t_march[..., None]
        d = brain_full_sdf(pts)
        min_sdf = np.minimum(min_sdf, d)
        hit_now = d < 0.0018
        hit_mask |= hit_now
        # Advance rays that haven't hit and haven't exited bounding sphere
        step = np.where(hit_mask | (t_march > t_max), 0.0, d * 0.82)
        t_march += step

    # Anti-aliased coverage at silhouette boundary
    edge_aa = 1.0 - smoothstep(-0.002, 0.007, min_sdf)
    valid = edge_aa > 0.005

    if not np.any(valid):
        return Image.fromarray(np.clip(frame_rgb, 0, 255).astype(np.uint8))

    # Subset to pixels that actually touch or graze the brain surface
    pts_hit = (ro_obj + rd_obj * t_march[..., None])[valid]
    rd_hit_world = rd_world[valid]
    aa_alpha = edge_aa[valid]

    # -----------------------------------------------------------------------
    # 5. Surface Normals, Sulcus Creases & Subsurface Scattering
    # -----------------------------------------------------------------------
    n_obj = compute_normals(pts_hit)
    n_macro_obj = compute_macro_normals(pts_hit)

    # Transform normals back to world space (accounting for inverse scale transpose)
    n_world = (n_obj * inv_scale) @ R_obj_to_world.T
    n_world /= np.linalg.norm(n_world, axis=-1, keepdims=True) + 1e-8

    n_macro_world = (n_macro_obj * inv_scale) @ R_obj_to_world.T
    n_macro_world /= np.linalg.norm(n_macro_world, axis=-1, keepdims=True) + 1e-8

    # Evaluate fold height and sulcus groove mask at surface points
    puffy_h, sulcus_mask = brain_sulci_field(pts_hit)

    # Also check medial longitudinal fissure depth for extra ambient occlusion
    px = pts_hit[..., 0]
    py = pts_hit[..., 1]
    pz = pts_hit[..., 2]
    medial_ao = np.exp(-32.0 * (px * px)) * smoothstep(-0.20, 0.35, py)
    total_crease = np.clip(sulcus_mask + 0.65 * medial_ao, 0.0, 1.0)

    # Ambient occlusion inside deep folds
    ao = 1.0 - 0.52 * total_crease

    # -----------------------------------------------------------------------
    # 6. Kawaii Facial Features (Painted on Object-Space Frontal Lobe)
    # -----------------------------------------------------------------------
    # Softly reduce fold darkness in the immediate eye/mouth zone
    face_front_mask = smoothstep(0.25, 0.55, pz)

    # Left & Right Eyes at (+/- 0.23, -0.02, +front)
    eye_cx = 0.235
    eye_cy = -0.015
    ex = np.abs(px) - eye_cx
    ey = py - eye_cy

    # Blinking squashes the vertical eye radius into a happy curved arc
    open_ratio = max(0.08, 1.0 - 0.92 * blink_amount)
    eye_rx = 0.068
    eye_ry = 0.078 * open_ratio

    # Slight cute upward arch when blinking
    blink_arch = 0.18 * blink_amount * ((ex / eye_rx) ** 2) * eye_ry
    eye_dist = np.sqrt((ex / eye_rx) ** 2 + ((ey + blink_arch) / eye_ry) ** 2)
    eye_mask = (1.0 - smoothstep(0.88, 1.02, eye_dist)) * face_front_mask

    # Eye specular catchlights (two cute anime/Pixar glossy white sparkles per eye)
    # Use actual X coordinate relative to each eye center so both eyes look same direction
    eye_local_x = np.where(px >= 0.0, px - eye_cx, px + eye_cx)
    eye_local_y = py - eye_cy
    hl1_dist = np.sqrt(((eye_local_x + 0.020) / 0.021) ** 2 + ((eye_local_y - 0.024) / 0.023) ** 2)
    hl2_dist = np.sqrt(((eye_local_x - 0.022) / 0.011) ** 2 + ((eye_local_y + 0.018) / 0.011) ** 2)
    eye_highlight = (
        (1.0 - smoothstep(0.75, 1.05, hl1_dist))
        + 0.85 * (1.0 - smoothstep(0.70, 1.05, hl2_dist))
    ) * (1.0 - blink_amount) * eye_mask
    eye_highlight = np.clip(eye_highlight, 0.0, 1.0)

    # Warm iris lower crescent glow inside the dark glossy eye
    iris_glow = smoothstep(-0.06, -0.01, eye_local_y) * (1.0 - smoothstep(-0.01, 0.04, eye_local_y)) * eye_mask

    # Rosy Airbrushed Cheeks just below and outside the eyes
    cheek_cx = 0.345
    cheek_cy = -0.105
    cheek_dist = np.sqrt(((np.abs(px) - cheek_cx) / 0.095) ** 2 + ((py - cheek_cy) / 0.062) ** 2)
    cheek_mask = np.exp(-2.2 * (cheek_dist ** 2)) * face_front_mask

    # Happy Cute Smile Arc between the cheeks
    mouth_w = 0.082
    mouth_x = np.clip(px / mouth_w, -1.0, 1.0)
    # Parabola curving upwards at the corners
    smile_curve_y = -0.105 + 0.032 * (mouth_x * mouth_x)
    mouth_dist = np.sqrt(
        (np.maximum(np.abs(px) - mouth_w, 0.0) ** 2)
        + ((py - smile_curve_y) ** 2)
    )
    mouth_mask = (1.0 - smoothstep(0.011, 0.019, mouth_dist)) * face_front_mask

    # -----------------------------------------------------------------------
    # 7. Pixar / Blender Stylized 3D Lighting & Subsurface Scattering
    # -----------------------------------------------------------------------
    view_dir = -rd_hit_world  # Points from surface to camera

    # Key Light: Warm studio softbox from upper-left-front
    key_dir = np.array([-0.48, 0.68, 0.55], dtype=np.float32)
    key_dir /= np.linalg.norm(key_dir)

    # Fill Light: Soft pastel lavender-blue fill from right-front
    fill_dir = np.array([0.65, 0.20, 0.73], dtype=np.float32)
    fill_dir /= np.linalg.norm(fill_dir)

    # Rim / Back Light: Strong warm peach-gold kicker from top-back
    rim_dir = np.array([0.15, 0.78, -0.60], dtype=np.float32)
    rim_dir /= np.linalg.norm(rim_dir)

    # Diffuse wrapped lighting (half-Lambert) for soft, fleshy, toy-like shading
    ndotl_key = np.sum(n_world * key_dir, axis=-1)
    ndotl_macro = np.sum(n_macro_world * key_dir, axis=-1)
    wrap_key = np.clip((ndotl_key + 0.45) / 1.45, 0.0, 1.0) ** 1.15

    ndotl_fill = np.clip((np.sum(n_world * fill_dir, axis=-1) + 0.5) / 1.5, 0.0, 1.0)

    # Subsurface Scattering (SSS): warm coral-red glow where light wraps around lobes
    # and illuminates the transition zones of the gyri
    sss_wrap = np.clip((ndotl_macro + 0.65) / 1.65, 0.0, 1.0) * (1.0 - np.clip(ndotl_key, 0.0, 1.0) * 0.6)
    sss_gyri = puffy_h * (0.4 + 0.6 * wrap_key)

    # Base Material Colors (Rich Bubblegum Rose, Warm Coral SSS, Deep Berry Sulci)
    col_crown = np.array([255.0, 152.0, 178.0], dtype=np.float32)   # Bright rosy pink gyri crowns
    col_mid = np.array([244.0, 114.0, 148.0], dtype=np.float32)     # Plush coral-pink midtone
    col_shadow = np.array([196.0, 68.0, 108.0], dtype=np.float32)   # Warm berry shadow
    col_sulcus = np.array([142.0, 38.0, 74.0], dtype=np.float32)    # Deep rich raspberry crease

    # Blend base albedo from gyrus crown to sulcus valley
    albedo = (
        col_crown * (puffy_h[..., None] * 0.75 + 0.25)
        * (1.0 - total_crease[..., None])
        + col_sulcus * total_crease[..., None]
    )

    # Blend rosy cheeks into the albedo
    col_cheek = np.array([255.0, 88.0, 128.0], dtype=np.float32)
    albedo = albedo * (1.0 - 0.58 * cheek_mask[..., None]) + col_cheek * (0.58 * cheek_mask[..., None])

    # Apply 3-point studio lighting + SSS
    lit_color = (
        albedo * (0.32 + 0.68 * wrap_key[..., None]) * ao[..., None]
        + col_shadow * (1.0 - wrap_key[..., None]) * 0.22
        + np.array([255.0, 110.0, 130.0], dtype=np.float32) * (sss_wrap * 0.26 + sss_gyri * 0.12)[..., None]
        + np.array([235.0, 210.0, 255.0], dtype=np.float32) * (ndotl_fill * 0.14)[..., None]
    )

    # Warm bounce light from the studio floor onto the lower hemisphere
    bounce_mask = np.clip(-n_macro_world[..., 1], 0.0, 1.0)
    lit_color += np.array([255.0, 195.0, 210.0], dtype=np.float32) * (bounce_mask * 0.16)[..., None]

    # Dual-lobe Glossy Specular Highlights (gives that appealing moist/vinyl 3D toy sheen)
    half_key = key_dir + view_dir
    half_key /= np.linalg.norm(half_key, axis=-1, keepdims=True) + 1e-8
    ndoth_key = np.clip(np.sum(n_world * half_key, axis=-1), 0.0, 1.0)

    # Attenuate specular inside deep sulci so only the plump gyri crowns shine
    crown_spec_mask = (1.0 - 0.85 * total_crease) * (1.0 - eye_mask) * (1.0 - mouth_mask)
    spec_broad = (ndoth_key ** 20.0) * 0.28 * crown_spec_mask
    spec_sharp = (ndoth_key ** 85.0) * 0.52 * crown_spec_mask

    lit_color += np.array([255.0, 245.0, 248.0], dtype=np.float32) * (spec_broad + spec_sharp)[..., None]

    # Fresnel Rim Light around the 3D contour
    ndotv = np.clip(np.sum(n_macro_world * view_dir, axis=-1), 0.0, 1.0)
    fresnel = ((1.0 - ndotv) ** 3.2) * (0.45 + 0.55 * np.clip(np.sum(n_macro_world * rim_dir, axis=-1), 0.0, 1.0))
    lit_color += np.array([255.0, 220.0, 232.0], dtype=np.float32) * (fresnel * 0.55)[..., None]

    # -----------------------------------------------------------------------
    # 8. Composite Cute Eyes & Smile on Top of the Shaded Frontal Lobe
    # -----------------------------------------------------------------------
    # Deep glossy espresso-plum eye color with warm amber-brown lower iris glow
    col_eye_base = np.array([34.0, 18.0, 32.0], dtype=np.float32)
    col_eye_iris = np.array([98.0, 44.0, 72.0], dtype=np.float32)
    col_eye = (
        col_eye_base * (1.0 - 0.55 * iris_glow[..., None])
        + col_eye_iris * (0.55 * iris_glow[..., None])
        + 255.0 * eye_highlight[..., None]
    )

    lit_color = lit_color * (1.0 - eye_mask[..., None]) + col_eye * eye_mask[..., None]

    # Cute dark berry smile line
    col_mouth = np.array([82.0, 24.0, 50.0], dtype=np.float32)
    lit_color = lit_color * (1.0 - mouth_mask[..., None]) + col_mouth * mouth_mask[..., None]

    # Filmic soft highlight roll-off & gamma polish
    lit_color = np.clip(lit_color, 0.0, 255.0)

    # Composite shaded 3D brain onto the studio background with anti-aliased edge
    valid_y = active_indices[0][valid]
    valid_x = active_indices[1][valid]

    bg_pixels = frame_rgb[valid_y, valid_x]
    frame_rgb[valid_y, valid_x] = bg_pixels * (1.0 - aa_alpha[..., None]) + lit_color * aa_alpha[..., None]

    # -----------------------------------------------------------------------
    # 9. Floating Cute Sparkle Hearts / Stars Around the Brain (2D/3D Overlay)
    # -----------------------------------------------------------------------
    img = Image.fromarray(np.clip(frame_rgb, 0, 255).astype(np.uint8))
    draw_sparkles(img, t)
    return img


def draw_sparkles(img, t):
    """Draws subtle, gentle floating pastel four-point sparkles around the brain."""
    draw = ImageDraw.Draw(img, "RGBA")
    w, h = img.size
    tau = 2.0 * np.pi * t

    # [base_x_frac, base_y_frac, max_radius, phase_offset]
    sparkles = [
        (0.18, 0.24, 16.0, 0.0),
        (0.83, 0.21, 14.0, 1.8),
        (0.85, 0.68, 12.0, 3.4),
        (0.15, 0.66, 13.0, 4.7),
    ]

    for bx, by, max_r, ph in sparkles:
        pulse = 0.5 + 0.5 * np.sin(tau + ph)
        if pulse < 0.12:
            continue
        r = max_r * (0.45 + 0.55 * pulse)
        cx = bx * w + 6.0 * np.cos(tau + ph)
        cy = by * h + 10.0 * np.sin(tau + ph)
        alpha = int(195 * pulse)

        # Draw a soft 4-point star polygon
        inner = r * 0.26
        pts = [
            (cx, cy - r),
            (cx + inner, cy - inner),
            (cx + r, cy),
            (cx + inner, cy + inner),
            (cx, cy + r),
            (cx - inner, cy + inner),
            (cx - r, cy),
            (cx - inner, cy - inner),
        ]
        draw.polygon(pts, fill=(255, 255, 255, alpha))




# ---------------------------------------------------------------------------
# 11-Stage (0..10) Brain Degradation Rig & WebP Sprite Pair Helpers (CAT02-11)
# ---------------------------------------------------------------------------
def compute_degradation_rig_params(stage_idx, num_stages=11):
    """
    Computes continuous degradation factor d in [0.0, 1.0] and 3D shader/rig
    parameters for stage_idx in 0..(num_stages - 1) corresponding to 50-reel
    increments (0, 50, 100, ..., 500+ reels).
    """
    s = max(0, min(num_stages - 1, int(stage_idx)))
    d = round(s / float(max(1, num_stages - 1)), 4)
    vitality = round(1.0 - 0.75 * d, 4)
    droop = round(min(1.0, d ** 0.80), 4)
    sparkle_fade = round(max(0.0, 1.0 - d * 1.6), 4)
    albedo_crown = (
        int(round((1.0 - d) * 255.0 + d * 224.0)),
        int(round((1.0 - d) * 152.0 + d * 234.0)),
        int(round((1.0 - d) * 178.0 + d * 246.0)),
    )
    return {
        "stageIndex": s,
        "reelsBracket": s * 50,
        "d": d,
        "vitalityFactor": vitality,
        "droopFactor": droop,
        "sparkleFade": sparkle_fade,
        "albedoCrownRgb": albedo_crown,
    }


def export_11_stage_webp_bundle(output_dir=OUTPUT_DIR):
    """
    Returns metadata for all 11 degradation stages (0..10, 50-reel steps)
    with paired open-eye and closed-eye blink keyframe descriptors.
    """
    os.makedirs(output_dir, exist_ok=True)
    stages = []
    for stage_idx in range(11):
        params = compute_degradation_rig_params(stage_idx, 11)
        params["openFrameIdx"] = 0
        params["closedFrameIdx"] = 42
        stages.append(params)
    return stages


# ---------------------------------------------------------------------------
# Main Generation Pipeline
# ---------------------------------------------------------------------------
def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    t0 = time.time()

    print(f"[1/4] Initializing {WIDTH}x{HEIGHT} camera rays and studio backdrop...")
    bg_rgb = build_studio_background(WIDTH, HEIGHT)

    # Precompute normalized camera ray directions across the 1080x1080 sensor
    y_idx, x_idx = np.mgrid[0:HEIGHT, 0:WIDTH].astype(np.float32)
    aspect = float(WIDTH) / float(HEIGHT)
    fov_scale = 0.42  # Framing scale so the plump 3D brain fills ~70% of the canvas nicely
    u = ((x_idx + 0.5) / WIDTH - 0.5) * 2.0 * aspect * fov_scale
    v = (0.5 - (y_idx + 0.5) / HEIGHT) * 2.0 * fov_scale
    w_dir = -np.ones_like(u)

    ray_grid = np.stack([u, v, w_dir], axis=-1)
    ray_grid /= np.linalg.norm(ray_grid, axis=-1, keepdims=True) + 1e-8

    frames = []
    print(f"[2/4] Rendering {NUM_FRAMES} 3D raymarched frames at {WIDTH}x{HEIGHT}...")
    for idx in range(NUM_FRAMES):
        f_start = time.time()
        img = render_frame(idx, NUM_FRAMES, bg_rgb, ray_grid)
        frames.append(img)
        if (idx + 1) % 10 == 0 or idx == 0:
            elapsed = time.time() - f_start
            print(f"      -> Frame {idx + 1:02d}/{NUM_FRAMES} rendered ({elapsed:.2f}s)")

    # Save high-res poster frame (Frame 0)
    frames[0].save(POSTER_FRAME_PATH, format="PNG", optimize=True)
    print(f"[3/4] Saved 1080p poster frame to: {POSTER_FRAME_PATH}")

    # Save a 2x2 keyframe sheet (Frames 0, 15, 30, 42 - including blink) for visual inspection
    sheet_size = 540
    sheet = Image.new("RGB", (sheet_size * 2, sheet_size * 2))
    key_indices = [0, 15, 30, 42]
    for i, k_idx in enumerate(key_indices):
        thumb = frames[k_idx].resize((sheet_size, sheet_size), Image.Resampling.LANCZOS)
        sheet.paste(thumb, ((i % 2) * sheet_size, (i // 2) * sheet_size))
    sheet.save(PREVIEW_SHEET_PATH, format="PNG", optimize=True)
    print(f"      Saved 4-keyframe inspection sheet to: {PREVIEW_SHEET_PATH}")

    # Quantize with a shared high-quality master palette + gentle dithering for smooth gradients
    print(f"[4/4] Encoding seamless looping 1080x1080 GIF ({FPS} FPS)...")
    master_palette_img = frames[0].quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    quantized_frames = [
        f.quantize(palette=master_palette_img, dither=Image.Dither.FLOYDSTEINBERG)
        for f in frames
    ]

    quantized_frames[0].save(
        GIF_PATH,
        format="GIF",
        save_all=True,
        append_images=quantized_frames[1:],
        duration=FRAME_DURATION_MS,
        loop=0,
        optimize=False,
    )

    total_time = time.time() - t0
    size_mb = os.path.getsize(GIF_PATH) / (1024 * 1024)
    print(f"Done in {total_time:.1f}s! Output GIF: {GIF_PATH} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
