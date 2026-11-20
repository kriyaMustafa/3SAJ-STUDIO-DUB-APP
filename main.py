import sys
import importlib.util
from pathlib import Path

backend_dir = Path(__file__).resolve().parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

backend_main_path = backend_dir / "main.py"
spec = importlib.util.spec_from_file_location("backend_main_module", backend_main_path)
mod = importlib.util.module_from_spec(spec)
sys.modules["backend_main_module"] = mod
spec.loader.exec_module(mod)
app = mod.app
