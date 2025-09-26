import os
import json
from typing import Optional, Any, Dict, List

from PIL import Image
from PIL.PngImagePlugin import PngInfo
from PIL import ImageDraw, ImageFont
from io import BytesIO

import folder_paths


class ThumbnailService:
    """Generates small, web-friendly thumbnails from ComfyUI output descriptors.

    Single responsibility: image IO and thumbnail encoding.
    """

    def __init__(self, max_size: int = 128, quality: int = 60):
        self.max_size = max_size
        self.quality = quality

    def generate_thumbnails_from_outputs(self, outputs: Optional[dict], *, workflow_json: Optional[str] = None, extras: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        if not outputs:
            return []
        images: List[Dict[str, Any]] = self._extract_image_descriptors(outputs)
        thumbs: List[Dict[str, Any]] = []
        for idx, desc in enumerate(images[:4]):
            thumb = self._encode_single_thumbnail(desc, idx, workflow_json=workflow_json, extras=extras)
            if thumb is not None:
                thumbs.append(thumb)
        return thumbs

    def generate_placeholder_thumbnail(self, status: str, *, workflow_json: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Create a placeholder WEBP thumbnail for failed/interrupted jobs.

        The placeholder encodes the workflow in EXIF so it can be restored via drag-and-drop.
        """
        try:
            size = int(self.max_size)
            # Locate provided placeholder asset
            placeholder_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'web', 'img', 'failed.png'))
            use_draw_fallback = True
            if os.path.isfile(placeholder_path):
                try:
                    with Image.open(placeholder_path) as base_img:
                        # Resize to fit within max size, maintain aspect ratio
                        w, h = base_img.size
                        scale = min(size / max(1, w), size / max(1, h), 1.0)
                        new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
                        if hasattr(Image, 'Resampling'):
                            resampling = Image.Resampling.LANCZOS
                        else:
                            resampling = Image.LANCZOS
                        img = base_img.convert('RGB').resize(new_size, resampling)
                        use_draw_fallback = False
                except Exception:
                    use_draw_fallback = True

            if use_draw_fallback:
                # Minimal drawn fallback if asset missing/unreadable
                bg = (28, 29, 32)
                color = (239, 68, 68) if (status or '').lower() == 'failed' else (234, 179, 8)
                text = '×' if (status or '').lower() == 'failed' else '!'
                img = Image.new('RGB', (size, size), bg)
                draw = ImageDraw.Draw(img)
                margin = 12
                rect = (margin, margin, size - margin, size - margin)
                try:
                    draw.rounded_rectangle(rect, radius=10, fill=color)
                except Exception:
                    draw.rectangle(rect, fill=color)
                try:
                    font = ImageFont.load_default()
                except Exception:
                    font = None
                if font is not None:
                    try:
                        bbox = draw.textbbox((0, 0), text, font=font)
                        tw = bbox[2] - bbox[0]
                        th = bbox[3] - bbox[1]
                    except Exception:
                        tw, th = draw.textlength(text, font=font), 10
                    tx = (size - tw) // 2
                    ty = (size - th) // 2
                    draw.text((tx, ty), text, font=font, fill=(255, 255, 255))

            buf = BytesIO()
            try:
                pnginfo = PngInfo()
                if workflow_json:
                    pnginfo.add_text('prompt', workflow_json)
                # Save lossless PNG to preserve colors and avoid artifacts
                img.save(buf, format='PNG', pnginfo=pnginfo, compress_level=4)
            except Exception:
                img.save(buf, format='PNG', compress_level=4)
            data = buf.getvalue()
            return {
                'idx': 0,
                'mime': 'image/png',
                'width': img.size[0],
                'height': img.size[1],
                'data': data,
            }
        except Exception:
            return None

    def _extract_image_descriptors(self, outputs: dict) -> List[Dict[str, Any]]:
        images: List[Dict[str, Any]] = []
        try:
            for v in (outputs or {}).values():
                if isinstance(v, dict):
                    imgs = v.get('images') or (v.get('ui') or {}).get('images') or []
                    if isinstance(imgs, list):
                        for i in imgs:
                            if isinstance(i, dict) and (i.get('filename') or i.get('name')):
                                images.append(i)
                elif isinstance(v, list):
                    for i in v:
                        if isinstance(i, dict) and (i.get('filename') or i.get('name')):
                            images.append(i)
        except Exception:
            return []
        return images

    def _encode_single_thumbnail(self, desc: Dict[str, Any], idx: int, *, workflow_json: Optional[str], extras: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        filename = desc.get('filename') or desc.get('name')
        folder_type = desc.get('type') or 'output'
        subfolder = desc.get('subfolder') or ''

        base_dir = folder_paths.get_directory_by_type(folder_type)
        if base_dir is None:
            return None
        img_dir = base_dir
        if subfolder:
            full_output_dir = os.path.join(base_dir, subfolder)
            if os.path.commonpath((os.path.abspath(full_output_dir), base_dir)) != base_dir:
                return None
            img_dir = full_output_dir
        file_path = os.path.join(img_dir, os.path.basename(filename))
        if not os.path.isfile(file_path):
            return None

        try:
            with Image.open(file_path) as img:
                # Resize preserving aspect ratio to fit within max_size
                w, h = img.size
                scale = min(self.max_size / max(1, w), self.max_size / max(1, h), 1.0)
                new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
                if hasattr(Image, 'Resampling'):
                    resampling = Image.Resampling.LANCZOS
                else:
                    resampling = Image.LANCZOS
                thumb_img = img.convert('RGB').resize(new_size, resampling)
                buf = BytesIO()
                # Embed workflow metadata into WEBP EXIF so drag-and-drop works
                try:
                    exif = thumb_img.getexif()
                    if workflow_json:
                        # Comfy expects 'prompt:<json>' in 0x0110 for WEBP
                        exif[0x0110] = "prompt:{}".format(workflow_json)
                    if extras:
                        tag = 0x010F
                        for k, v in extras.items():
                            try:
                                exif[tag] = f"{k}:{json.dumps(v)}"
                            except Exception:
                                pass
                            tag -= 1
                    thumb_img.save(buf, format='WEBP', quality=self.quality, exif=exif)
                except Exception:
                    thumb_img.save(buf, format='WEBP', quality=self.quality)
                data = buf.getvalue()
                return {
                    'idx': idx,
                    'mime': 'image/webp',
                    'width': new_size[0],
                    'height': new_size[1],
                    'data': data,
                }
        except Exception:
            return None


