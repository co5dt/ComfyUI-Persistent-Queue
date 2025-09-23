import logging

# Expose empty node mappings to satisfy ComfyUI V1 loader
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# Optional: serve web assets if present
WEB_DIRECTORY = "./web"

# Install persistent queue hooks as soon as this extension is imported.
try:
    from .server.queue_manager import queue_manager
    queue_manager.initialize()
except Exception as e:
    logging.debug(f"ComfyUI-PersistentQueue initialization failed: {e}")

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']