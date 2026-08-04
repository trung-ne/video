"""GPU-free contract tests for the expressive TTS HTTP adapter.

Run this with the Python environment used by ``tts_router.py``; a base Python
without the optional audio stack reports a normal skipped test.
"""
from __future__ import annotations

import unittest

try:
    import io
    import json
    import sys
    import tempfile
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from pathlib import Path
    import numpy as np
    import soundfile as sf
except ModuleNotFoundError as exc:
    _AUDIO_DEP_ERROR = exc.name
else:
    _AUDIO_DEP_ERROR = None


if _AUDIO_DEP_ERROR:
    class RouterContractTests(unittest.TestCase):
        @unittest.skip(f"TTS HTTP contract test needs optional audio dependency: {_AUDIO_DEP_ERROR}")
        def test_optional_audio_dependency(self):
            pass
else:
    sys.path.insert(0, str(Path(__file__).parent))
    from tts_router import HttpBackend, KokoroBackend  # noqa: E402

    class ContractHandler(BaseHTTPRequestHandler):
        request_body: dict = {}
        authorization = ""

        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.path != "/health":
                self.send_error(404); return
            self.send_response(200); self.end_headers()

        def do_POST(self):
            ContractHandler.authorization = self.headers.get("Authorization", "")
            ContractHandler.request_body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            stream = io.BytesIO(); sf.write(stream, np.zeros(240, dtype=np.float32), 24000, format="WAV")
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("X-TTS-Model", "mock-qwen")
            self.send_header("X-TTS-Version", "test")
            self.send_header("X-TTS-Seed", "17")
            self.end_headers(); self.wfile.write(stream.getvalue())

    class RouterContractTests(unittest.TestCase):
        def setUp(self):
            self.server = ThreadingHTTPServer(("127.0.0.1", 0), ContractHandler)
            self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
            self.url = f"http://127.0.0.1:{self.server.server_port}"

        def tearDown(self):
            self.server.shutdown(); self.thread.join(); self.server.server_close()

        def test_qwen_adapter_sends_unified_contract_and_wav(self):
            env = {"TTS_QWEN_BASE_URL": self.url, "TTS_QWEN_MODEL": "Qwen-test", "TTS_API_TOKEN": "local-test-token"}
            backend = HttpBackend("qwen3", env, Path.cwd())
            backend.health()
            with tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "scene.wav"
                result = backend.synthesize({"id": "scene-001", "spokenText": "Hello market.", "ttsInstruction": "Warm."}, "en", "Ryan", 17, 1, output)
                self.assertTrue(output.exists())
                self.assertEqual(sf.info(output).samplerate, 24000)
            self.assertEqual(result.model, "mock-qwen")
            self.assertEqual(ContractHandler.authorization, "Bearer local-test-token")
            self.assertEqual(ContractHandler.request_body["spokenText"], "Hello market.")
            self.assertEqual(ContractHandler.request_body["ttsInstruction"], "Warm.")
            self.assertEqual(ContractHandler.request_body["language"], "en")
            self.assertEqual(ContractHandler.request_body["voice"], "Ryan")

        def test_style_bert_rejects_freeform_instruction_before_network(self):
            env = {"TTS_STYLE_BERT_BASE_URL": self.url, "TTS_STYLE_BERT_MODEL": "JP-Extra", "TTS_STYLE_BERT_STYLE_JA": "Neutral"}
            backend = HttpBackend("style_bert_vits2", env, Path.cwd())
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaisesRegex(RuntimeError, "only accepts configured style labels"):
                    backend.synthesize({"id": "scene-001", "spokenText": "こんにちは", "ttsInstruction": "Warm, skeptical."}, "ja", "Ono_Anna", 1, 1, Path(directory) / "scene.wav")
        def test_kokoro_deterministic_backend_does_not_repeat_identical_attempts(self):
            backend = KokoroBackend("kokoro", {}, Path.cwd())
            self.assertEqual(backend.attempt_limit(3), 1)


if __name__ == "__main__":
    unittest.main()
