"""Render actual asciinema output into a clearly labelled backend verification MP4.
Requires Pillow and ffmpeg. Usage: python scripts/render-recording.py input.cast output.mp4
"""
import json, math, re, shutil, subprocess, sys, tempfile, textwrap
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
source, destination = map(Path, sys.argv[1:3])
rows = [json.loads(line) for line in source.read_text(encoding='utf-8').splitlines() if line.strip()]
header, events = rows[0], rows[1:]
ffmpeg = shutil.which('ffmpeg')
if not ffmpeg: raise SystemExit('ffmpeg is required')
font_paths = ['C:/Windows/Fonts/consola.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf']
font_path = next((p for p in font_paths if Path(p).exists()), None)
font = ImageFont.truetype(font_path, 23) if font_path else ImageFont.load_default()
small = ImageFont.truetype(font_path, 17) if font_path else font
big = ImageFont.truetype(font_path, 34) if font_path else font
end = max([e[0] for e in events] or [0]) + 5
fps = 2
destination.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='phantom-video-') as scratch:
    for frame in range(math.ceil(end * fps)):
        t = frame / fps
        text = ''.join(e[2] for e in events if e[0] <= t and e[1] == 'o')
        text = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', text).replace('\r', '')
        lines = [part for line in text.splitlines() for part in (textwrap.wrap(line, 91, replace_whitespace=False) or [''])][-17:]
        im = Image.new('RGB', (1280, 800), '#12101A'); draw = ImageDraw.Draw(im)
        draw.text((46, 30), 'PHANTOM / backend verification', font=big, fill='#A78BFA')
        draw.text((46, 86), 'Recorded CLI output | Live Cerebras + real Codex | Not a UI demo', font=small, fill='#B8B2C8')
        draw.rounded_rectangle((30, 135, 1250, 720), radius=16, fill='#1C1930')
        for n, line in enumerate(lines):
            color = '#5EE6A0' if ('REAL:' in line or 'passed' in line or '"success":true' in line) else '#F2EFF8'
            draw.text((50, 157 + 30*n), line, font=font, fill=color)
        draw.text((46, 751), f'Actual elapsed recording time: {t:05.1f}s', font=small, fill='#B8B2C8')
        im.save(Path(scratch) / f'{frame:05d}.png')
    subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-framerate', str(fps), '-i', str(Path(scratch)/'%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(destination)], check=True)
print(destination)
